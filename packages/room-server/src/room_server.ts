import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import bind from 'bind-decorator';
import express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import { AddressInfo } from 'net';
import { HandSample, HandMatcher, MatchResult } from './hand_matcher';
import { vecFromAvVector } from '@aardvarkxr/aardvark-shared';

interface MemberInfo
{
	connection: Connection;
	peersToCreate: Connection[];
	memberId: number;
}

class Room
{
	public owner: Connection;
	readonly roomId: string;
	public members: MemberInfo[] = [];
	private nextMemberId = 1;
	private server: RoomServer;

	constructor( owner: Connection, server: RoomServer )
	{
		this.owner = owner;
		this.roomId = uuid();
		this.server = server;
	}

	private findMemberIndex( connection: Connection )
	{
		return this.members.findIndex( ( value: MemberInfo ) => value.connection == connection );
	}

	private findMember( connection: Connection )
	{
		let memberIndex = this.findMemberIndex( connection );
		if( memberIndex == -1 )
		{
			return undefined;
		}
		else
		{
			return this.members[ memberIndex ];
		}
	}

	private findMemberById( memberId: number )
	{
		return this.members.find( ( value: MemberInfo ) => value.memberId == memberId );
	}

	public join( newMember: Connection )
	{
		if( this.findMemberIndex( newMember ) != -1 )
		{
			return RoomResult.AlreadyInThisRoom;
		}

		// send all existing members an info request to
		// send to the new guy
		let infoRequestMsg : RoomMessage =
		{
			type: RoomMessageType.RequestMemberInfo,
			roomId: this.roomId,
		};
		for( let member of this.members )
		{
			member.connection.sendMessage( infoRequestMsg );
			member.peersToCreate.push( newMember );
		}

		if( this.members.length > 0 )
		{
			global.setTimeout( () => { newMember.sendMessage( infoRequestMsg ); }, 0 );			
		}

		let newMemberInfo: MemberInfo =
		{
			connection: newMember,
			memberId: this.nextMemberId++,
			peersToCreate: this.members.map( ( value ) => value.connection ),
		};

		this.members.push( newMemberInfo );

		return RoomResult.Success;
	}

	public leave( newMember: Connection )
	{
		let i = this.findMemberIndex( newMember );
		if( i == -1 )
		{
			return RoomResult.UnknownMember;
		}
		
		let memberId = this.members[i].memberId;
		this.members.splice( i, 1  );

		let leftMsg: RoomMessage =
		{
			type: RoomMessageType.MemberLeft,
			roomId: this.roomId,
			memberId,
		};

		for( let peerInfo of this.members )
		{
			peerInfo.connection.sendMessage( leftMsg );
		}
		return RoomResult.Success;
	}

	public ejectAll()
	{
		let ejectMsg : RoomMessage =
		{
			type: RoomMessageType.EjectedFromRoom,
			roomId: this.roomId,
		};

		for( let member of this.members )
		{
			member.connection.sendMessage( ejectMsg );
		}

		this.members = [];
	}

	public memberInitInfo( member: Connection, initInfo?: object )
	{
		let memberInfo = this.findMember( member );
		if( !memberInfo )
		{
			this.server.log( "memberGadgetInfo call from a non-member" );
			return;
		}

		let remoteUserMsg: RoomMessage =
		{
			type: RoomMessageType.AddRemoteMember,
			roomId: this.roomId,
			memberId: memberInfo.memberId,
			initInfo: initInfo,
		}
		for( let peer of memberInfo.peersToCreate )
		{
			peer.sendMessage( remoteUserMsg );
		}
		memberInfo.peersToCreate = [];
	}

	public messageFromPrimary( member: Connection, message: object, messageIsReliable?: boolean )
	{
		let memberInfo = this.findMember( member );
		if( !memberInfo )
		{
			this.server.log( "memberGadgetInfo call from a non-member" );
			return;
		}

		let primaryMsg: RoomMessage =
		{
			type: RoomMessageType.MessageFromPrimary,
			roomId: this.roomId,
			memberId: memberInfo.memberId,
			message,
			messageIsReliable,
		}

		for( let peerInfo of this.members )
		{
			if( memberInfo.peersToCreate.includes( peerInfo.connection ) )
			{
				// no need to send this message to this particular peer
				// because they haven't received the init info for this user yet
				continue;
			}
			if( peerInfo.connection == member )
			{
				continue;
			}

			peerInfo.connection.sendMessage( primaryMsg );
		}
	}

	public messageFromSecondary( member: Connection, peerId: number, 
		message: object, messageIsReliable?: boolean )
	{
		let memberInfo = this.findMember( member );
		if( !memberInfo )
		{
			this.server.log( "messageFromSecondary call from a non-member" );
			return;
		}

		let peerInfo = this.findMemberById( peerId );
		if( !peerInfo )
		{
			this.server.log( "messageFromSecondary call for a non-member" );
			return;
		}

		let secondaryMsg: RoomMessage =
		{
			type: RoomMessageType.MessageFromSecondary,
			roomId: this.roomId,
			memberId: peerId,
			message,
			messageIsReliable,
		}

		peerInfo.connection.sendMessage( secondaryMsg );
	}
}


export class Connection
{
	private ws:WebSocket;
	private handlers: { [ msgType: number ]: ( msg: RoomMessage ) => void } = {};
	private server: RoomServer;
	private rooms: Room[] = [];

	constructor( ws: WebSocket, server: RoomServer )
	{
		this.ws = ws;
		this.server = server;
		
		this.ws.onmessage = this.onMessage;
		this.ws.onclose = this.onClose;

		this.handlers[ RoomMessageType.JoinRoom ] = this.onMsgJoinRoom;
		this.handlers[ RoomMessageType.JoinRoomWithMatch ] = this.onMsgJoinRoomWithMatch;
		this.handlers[ RoomMessageType.LeaveRoom ] = this.onMsgLeaveRoom;
		this.handlers[ RoomMessageType.CreateRoom ] = this.onMsgCreateRoom;
		this.handlers[ RoomMessageType.DestroyRoom ] = this.onMsgDestroyRoom;
		this.handlers[ RoomMessageType.RequestMemberResponse ] = this.onMsgRequestMemberResponse;
		this.handlers[ RoomMessageType.MessageFromPrimary ] = this.onMsgMessageFromPrimary;
		this.handlers[ RoomMessageType.MessageFromSecondary ] = this.onMsgMessageFromSecondary;
	}

	public sendMessage( msg: RoomMessage )
	{
		this.ws.send( JSON.stringify( msg ) );
	}

	@bind
	private onMessage( evt: WebSocket.MessageEvent )
	{
		try
		{
			let msg = JSON.parse( evt.data as string ) as RoomMessage;
			let handler = this.handlers[ msg.type ];
			if( !handler )
			{
				this.server?.log( `No handler for message of type ${ RoomMessageType[ msg.type ]}`, msg );
			}
			else
			{
				handler( msg );
			}
		}
		catch( e )
		{
			this.server?.log( `Exception when processing message`, evt );
			if( this.server?.testMode )
			{
				throw e;
			}
		}
	}

	@bind
	private onClose( evt: WebSocket.CloseEvent )
	{
		for( let room of this.rooms )
		{
			room.leave( this );
		}
		this.rooms = [];
	}

	@bind 
	private onMsgJoinRoom( msg: RoomMessage )
	{
		let result: RoomResult;
		if( !msg.roomId )
		{
			result = RoomResult.InvalidParameters;
		}
		else
		{
			let room = this.server.findRoom( msg.roomId )
			if( !room )
			{
				result = RoomResult.NoSuchRoom;
			}
			else
			{
				result = room.join( this );

				if( result == RoomResult.Success )
				{
					this.rooms.push( room );
				}
			}
		}

		let response: RoomMessage =
		{
			type: RoomMessageType.JoinRoomResponse,
			result,
		};

		this.sendMessage( response );
	}

	@bind 
	private onMsgJoinRoomWithMatch( msg: RoomMessage )
	{
		let distance: number;
		{
			let leftPos = vecFromAvVector( msg.leftHandPosition );
			let rightPos = vecFromAvVector( msg.rightHandPosition );
			let diff = leftPos.subtract( rightPos );
			distance = diff.length();
		}

		let sample: HandSample =
		{
			leftHeight: msg.leftHandPosition.y,
			rightHeight: msg.rightHandPosition.y,
			distance,
			context: this,
		}

		this.server.addHandSample( sample );
	}

	@bind 
	private onMsgLeaveRoom( msg: RoomMessage )
	{
		let result: RoomResult;
		if( !msg.roomId )
		{
			result = RoomResult.InvalidParameters;
		}
		else
		{
			let room = this.server.findRoom( msg.roomId )
			if( !room )
			{
				result = RoomResult.NoSuchRoom;
			}
			else
			{
				result = room.leave( this );
				
				if( result == RoomResult.Success )
				{
					let roomIndex = this.rooms.indexOf( room );
					if( roomIndex != -1 )
					{
						this.rooms.splice( roomIndex, 1 );
					}
				}
			}
		}

		let response: RoomMessage =
		{
			type: RoomMessageType.LeaveRoomResponse,
			result,
		};

		this.sendMessage( response );
	}

	@bind 
	private onMsgCreateRoom( msg: RoomMessage )
	{
		const [ result, room ] = this.server.createRoom( this );

		let response: RoomMessage =
		{
			type: RoomMessageType.CreateRoomResponse,
			result,
			roomId: room?.roomId,
		};

		this.sendMessage( response );
	}

	@bind 
	private onMsgDestroyRoom( msg: RoomMessage )
	{
		let result: RoomResult;
		if( !msg.roomId )
		{
			result = RoomResult.InvalidParameters;
		}
		else
		{
			result = this.server.destroyRoom( this, msg.roomId );
		}

		let response: RoomMessage =
		{
			type: RoomMessageType.DestroyRoomResponse,
			result,
			roomId: msg?.roomId,
		};

		this.sendMessage( response );
	}

	@bind
	private onMsgRequestMemberResponse( msg: RoomMessage )
	{
		let room = this.server.findRoom( msg.roomId );
		room?.memberInitInfo( this, msg.initInfo ?? {} );
	}

	@bind
	private onMsgMessageFromPrimary( msg: RoomMessage )
	{
		let room = this.server.findRoom( msg.roomId );
		room?.messageFromPrimary( this, msg.message ?? {}, msg.messageIsReliable );
	}

	@bind
	private onMsgMessageFromSecondary( msg: RoomMessage )
	{
		let room = this.server.findRoom( msg.roomId );
		if( !msg.memberId )
		{
			throw new Error( "MessageFromSecondary missing required memberId" );
		}
		room?.messageFromSecondary( this, msg.memberId, msg.message ?? {}, msg.messageIsReliable );
	}

	cleanup()
	{
		( this.server as any ) = undefined;
	}
}


export interface RoomServerOptions
{
	testMode?: boolean;
}

export class RoomServer
{

	private app = express();
	private server = http.createServer( this.app );
	private wss: WebSocket.Server;
	private nextConnectionId = 27;
	private port: number;
	private connections: Connection[] = [];
	private options: RoomServerOptions | undefined;
	private rooms = new Map< string, Room> ();
	private matcher = new HandMatcher( this.onHandMatch );

	constructor( port?: number, options?: RoomServerOptions )
	{
		this.options = options;
		this.wss = new WebSocket.Server( { server: this.server } );

		this.server.on( 'error', ( e:NodeJS.ErrnoException ) =>
		{
			if( e.code === 'EADDRINUSE' )
			{
				console.log( `Can't listen on port ${port}. Exiting` );
				process.exit( -100 );
			}
		} );

		this.port = port ?? 24567;
	}

	public get testMode(): boolean
	{
		return this.options?.testMode ?? false;
	}

	public log( msg: string, ...args: any )
	{
		if( !this.testMode )
		{
			console.log( msg, ...args );
		}
	}

	async init()
	{
		return new Promise<void>( ( resolve, reject ) =>
		{
			this.server.listen( this.port, "127.0.0.1", () => 
			{
				this.port = ( this.server.address() as AddressInfo )?.port;
				this.log(`Room Server started on port ${ this.port } :)`);
	
				this.wss.on('connection', this.onConnection );

				resolve();
			} );
		} );
	}

	async cleanup()
	{
		for( let conn of this.connections )
		{
			conn.cleanup();
		}
		this.connections = [];

		this.server.close();
		this.rooms.clear();
	}

	public get portNumber()
	{
		return this.port;
	}

	@bind 
	private onConnection( ws: WebSocket, request: http.IncomingMessage )
	{
		this.log( "new connection" );		
		this.connections.push( new Connection( ws, this ) );
	}

	public createRoom( owner: Connection ) : [ RoomResult, Room | undefined ]
	{
		let room = new Room( owner, this );
		this.rooms.set( room.roomId, room );
		return [ RoomResult.Success, room ];
	}

	public findRoom( roomId?: string )
	{
		if( !roomId )
			return undefined;

		return this.rooms.get( roomId );
	}

	public destroyRoom( connection: Connection, roomId: string )
	{
		let room = this.findRoom( roomId );
		if( !room )
			return RoomResult.NoSuchRoom;

		if( room.owner != connection )
			return RoomResult.PermissionDenied;

		room.ejectAll();
		this.rooms.delete( roomId );
		return RoomResult.Success;
	}

	public addHandSample( sample: HandSample )
	{
		this.log( `Added hand sample at ${ sample.leftHeight }, ${ sample.rightHeight }` );
		this.matcher.addSample( sample );
	}

	@bind
	private onHandMatch( result: MatchResult, contexts: any[] )
	{
		switch( result )
		{
			case MatchResult.TimedOut:
			case MatchResult.Replaced:
			{
				let resp: RoomMessage =
				{
					type: RoomMessageType.JoinRoomWithMatchResponse,
					result: result == MatchResult.TimedOut ? RoomResult.MatchTimedOut : RoomResult.ClickReplaced,
				};

				for( let context of contexts )
				{
					let conn = context as Connection;
					conn.sendMessage( resp );
				}
			}
			break;

			case MatchResult.Matched:
			{
				let owner = contexts[0] as Connection;
				let [ result, newRoom ] = this.createRoom( owner );
				if( result != RoomResult.Success )
				{
					this.log( "Somehow failed to make a new room: ", RoomResult[ result ] );
					break;
				}

				let resp: RoomMessage =
				{
					type: RoomMessageType.JoinRoomWithMatchResponse,
					result: RoomResult.Success,
					roomId: newRoom.roomId,
				};

				for( let context of contexts )
				{
					let conn = context as Connection;
					conn.sendMessage( resp );

					newRoom.join( conn );
				}
			}
			break;
		}
	}
}
