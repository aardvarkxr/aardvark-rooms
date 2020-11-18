import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import bind from 'bind-decorator';
import express from 'express';
import * as http from 'http';
import * as path from 'path';
import * as WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import { AddressInfo } from 'net';
import { HandSample, HandMatcher, MatchResult } from './hand_matcher';
import { AvVector, vecFromAvVector, AvNodeTransform, minimalToMat4Transform, nodeTransformToMat4, nodeTransformFromMat4, rotationMatFromEulerDegrees, translateMat } from '@aardvarkxr/aardvark-shared';
import { mat4, vec3, vec4 } from '@tlaukkan/tsm';

export let g_localInstallPath = path.resolve( path.dirname( __filename ), "../../.." );

interface MemberInfo
{
	connection: Connection;
	peersToCreate: Connection[];
	memberId: number;
	roomFromMember: AvNodeTransform;
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

	public getRoomFromMember( memberConnection: Connection )
	{
		return this.findMember( memberConnection )?.roomFromMember;
	}

	public joinViaHost( newMember: Connection, host: Connection, hostFromMember: mat4 )
	{
		let hostInfo = this.findMember( host );
		if( !hostInfo )
		{
			this.server.log( "Couldn't find host in room when adding connect", this.roomId );
			return;
		}

		let roomFromHost = nodeTransformToMat4( hostInfo.roomFromMember );
		let roomFromMember = mat4.product( roomFromHost, hostFromMember, new mat4() );

		// this.server.log( `roomFromHost = ${  roomFromHost.all() }` );
		// this.server.log( `roomFromMember = ${  roomFromMember.all() }` );

		return this.join( newMember, nodeTransformFromMat4( roomFromMember ) );
	}

	public join( newMember: Connection, roomFromMember?: AvNodeTransform )
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
			roomFromMember: roomFromMember ?? {},
			peersToCreate: this.members.map( ( value ) => value.connection ),
		};
		
		this.members.push( newMemberInfo );

		let roomInfoMsg: RoomMessage =
		{
			type: RoomMessageType.UpdateRoomInfo,
			roomId: this.roomId,
			roomFromMember: newMemberInfo.roomFromMember,
		}	
		newMember.sendMessage( roomInfoMsg );

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
			roomFromMember: memberInfo.roomFromMember,
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
	public room: Room;
	public leftHandPosition: AvVector = null;
	public rightHandPosition: AvVector = null;

	constructor( ws: WebSocket, server: RoomServer )
	{
		this.ws = ws;
		this.server = server;
		
		this.ws.onmessage = this.onMessage;
		this.ws.onclose = this.onClose;

		this.handlers[ RoomMessageType.JoinRoom ] = this.onMsgJoinRoom;
		this.handlers[ RoomMessageType.JoinRoomWithMatch ] = this.onMsgJoinRoomWithMatch;
		this.handlers[ RoomMessageType.RequestMemberResponse ] = this.onMsgRequestMemberResponse;
		this.handlers[ RoomMessageType.MessageFromPrimary ] = this.onMsgMessageFromPrimary;
		this.handlers[ RoomMessageType.MessageFromSecondary ] = this.onMsgMessageFromSecondary;

		// every connection is in a room all the time. They start in a room by themselves,
		// standing at the origin
		let [ res, room ] = server.createRoom( this );
		if( res != RoomResult.Success )
		{
			server.log( "Somehow failed to create new room for incoming connection", RoomResult[ res ] );
		}
		else
		{
			res = room.join( this );
			if( res != RoomResult.Success )
			{
				server.log( "Somehow failed to join new room for incoming connection", RoomResult[ res ] );
			}
			else
			{
				this.room = room;
			}
		}
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
		this.room?.leave( this );
		this.room = null;
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
					this.room = room;
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
			let diff = new vec3( [ rightPos.x - leftPos.x, rightPos.y - leftPos.y, rightPos.z - leftPos.z ] );
			distance = diff.length();
		}

		let sample: HandSample =
		{
			leftHeight: msg.leftHandPosition.y,
			rightHeight: msg.rightHandPosition.y,
			distance,
			context: this,
		}

		this.leftHandPosition = msg.leftHandPosition;
		this.rightHandPosition = msg.rightHandPosition;

		this.server.addHandSample( sample );
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

		this.app.use( "/gadget", express.static( 
			path.resolve( g_localInstallPath, "packages/room-gadget/dist" ),
			{
				setHeaders: ( res: express.Response, path: string ) =>
				{
					if( path.endsWith( ".webmanifest" ) || path.endsWith( ".glb" ) )
					{
						res.setHeader( "Access-Control-Allow-Origin", "*" );
					}
				}
			}) );
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
			this.server.listen( this.port, () => 
			{
				this.port = ( this.server.address() as AddressInfo )?.port;
				this.log(`Room Server started on port ${ this.port } :)`);
				this.log( `Running from ${ g_localInstallPath }` );
	
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

	private processMatch( contexts: any[] )
	{
		// TODO:
		// remember the actual positions. We're going to need them when a match happens
		// When figuring out a match, see if either user is already in a room.
		//   If they're in the same room, we're just updating transforms. Pick one user, compute relative
		//     transform form that user to the other user, update other user's transform. (This is essentially
		//     the same as leaving the room and then using the "one user in room" case, just with less 
		//     thrashing of gadgets.)
		//   If one of them is in the room, the second user us joining the first user's room. Compute
		//     relative transform, multiply that by the first user's room transform, and that's the 
		//     second user's transform in the room. Join the room with that
		//   If neither is in a room, create a new room using the first user's right hand and y=0 plane
		//     as the center of the room (so their transform relative to the room is identity) and then
		//     join the room as the second user just like you would in the "one in room" case
		//   If each user is in their own room, pick the user who is in the room with the largest number 
		//     of members, have the other user leave their room and then proceed as though only one was 
		//     in a room.
		if( contexts.length != 2 )
		{
			this.log( "Somehow we got other-than-2 contexts on a match" );
			return;
		}

		let a = contexts[0] as Connection;
		let b = contexts[1] as Connection;

		let host: Connection;
		let joiner: Connection;
		if( a.room.members.length > b.room.members.length )
		{
			host = a;
			joiner = b;
		}
		else
		{
			host = b;
			joiner = a;
		}

		if( joiner.room == host.room )
		{
			this.log( "Need to add support for repositioning within a room" );
			return;
		}

		function lerp( a: vec3, b: vec3, t: number ): vec3
		{
			let d = new vec3( [ b.x - a.x, b.y - a.y, b.z - a.z ] );
			return new vec3( [ a.x + d.x * t, a.y + d.y * t, a.z + d.z * t ] );
		}

		// figure out the transform from joiner to host
		let joinerLeft = vecFromAvVector( joiner.leftHandPosition );
		let joinerRight = vecFromAvVector( joiner.rightHandPosition );
		let joinerCenter = lerp( joinerLeft, joinerRight, 0.5 );
		let hostLeft = vecFromAvVector( host.leftHandPosition );
		let hostRight = vecFromAvVector( host.rightHandPosition );
		let hostCenter = lerp( hostLeft, hostLeft, 0.5 );
		
		function yawFromTwoPoints( start: vec3, end: vec3 ): number
		{
			let diff = vec3.difference( end, start, new vec3() );
			diff.y = 0;
			
			//console.log( `diff=${ diff.xyz }` );
			// the diff can't be vertical and have this really work
			if( diff.length() < 0.001 )
			{
				//console.log( `len=${ diff.length() }` );
				return 0;
			}
			
			diff.normalize();
			//console.log( `normalizedDiff=${ diff.xyz }` );
			return Math.atan2( diff.z, diff.x );
		}
		
		// figure out the host's transform relative to the room
		let roomFromHost = host.room.getRoomFromMember( host );
		let roomFromHostMat = nodeTransformToMat4( roomFromHost );

		let leftInRoom = new vec3( roomFromHostMat.multiplyVec4( new vec4( [ ...hostLeft.xyz, 1 ] ) ).xyz );
		let rightInRoom = new vec3( roomFromHostMat.multiplyVec4( new vec4( [ ...hostRight.xyz, 1 ] ) ).xyz );
		let centerInRoom = lerp( leftInRoom, rightInRoom, 0.5 );

		let hostYaw = yawFromTwoPoints( rightInRoom, leftInRoom );
		let joinerYaw = yawFromTwoPoints( joinerRight, joinerLeft );
		let hostFromJoinerYaw = joinerYaw + hostYaw; 

		let hostFromJoinerRotation = rotationMatFromEulerDegrees( 
			new vec3( [ 0, hostFromJoinerYaw * 180 / Math.PI, 0 ] ) );

		let joinerCenterInHost = hostFromJoinerRotation.multiplyVec3( joinerCenter );
		let hostFromJoinerTranslation = vec3.difference( centerInRoom, joinerCenterInHost, new vec3() );

		let hostFromJoiner = translateMat( hostFromJoinerTranslation ).multiply( hostFromJoinerRotation );

		function displayRadians( r: number )
		{
			return ( r * 180 / Math.PI ).toFixed( 0 );
		}

		this.log( "----" );
		this.log( `hostYaw = ${  displayRadians( hostYaw ) }` );
		this.log( `joinerYaw = ${  displayRadians( joinerYaw ) }` );
		this.log( `hostFromJoinerYaw = ${  displayRadians( hostFromJoinerYaw ) }` );
		this.log( `hostFromJoinerTranslation = ${ hostFromJoinerTranslation.xyz }` );
		this.log( `hostLeft = ${ hostLeft.xyz }` );
		this.log( `hostRight = ${ hostRight.xyz }` );
		this.log( `joinerLeft = ${  joinerLeft.xyz }` );
		this.log( `joinerRight = ${ joinerRight.xyz }` );
		this.log( `hostFromJoiner = ${  hostFromJoiner.all() }` );

		this.log( "matched two samples" );

		let resp: RoomMessage =
		{
			type: RoomMessageType.JoinRoomWithMatchResponse,
			result: RoomResult.Success,
			roomId: host.room.roomId,
		};

		host.sendMessage( resp );
		joiner.sendMessage( resp );

		joiner.room.leave( joiner );
		host.room.joinViaHost( joiner, host, hostFromJoiner );
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
				this.processMatch( contexts );
			}
			break;
		}
	}
}
