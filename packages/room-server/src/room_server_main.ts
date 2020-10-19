import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import bind from 'bind-decorator';
import express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import { v4 as uuid } from 'uuid';


class Room
{
	public owner: Connection;
	readonly roomId: string;
	public members: Connection[] = [];

	constructor( owner: Connection )
	{
		this.owner = owner;
		this.roomId = uuid();
	}

	public join( newMember: Connection )
	{
		if( this.members.indexOf( newMember ) != -1 )
		{
			return RoomResult.AlreadyInThisRoom;
		}

		this.members.push( newMember );
		return RoomResult.Success;
	}

	public leave( newMember: Connection )
	{
		let i = this.members.indexOf( newMember );
		if( i == -1 )
		{
			return RoomResult.UnknownMember;
		}
		
		this.members.splice( i, 1  );
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
			member.sendMessage( ejectMsg );
		}

		this.members = [];
	}
}

export class Connection
{
	private ws:WebSocket;
	private handlers: { [ msgType: number ]: ( msg: RoomMessage ) => void } = {};
	private server: RoomServer;

	constructor( ws: WebSocket, server: RoomServer )
	{
		this.ws = ws;
		this.server = server;
		
		this.ws.onmessage = this.onMessage;

		this.handlers[ RoomMessageType.JoinRoom ] = this.onMsgJoinRoom;
		this.handlers[ RoomMessageType.LeaveRoom ] = this.onMsgLeaveRoom;
		this.handlers[ RoomMessageType.CreateRoom ] = this.onMsgCreateRoom;
		this.handlers[ RoomMessageType.DestroyRoom ] = this.onMsgDestroyRoom;
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
				this.server.log( `No handler for message of type ${ RoomMessageType[ msg.type ]}`, msg );
			}
			else
			{
				handler( msg );
			}
		}
		catch( e )
		{
			this.server.log( `Exception when processing message`, evt );
			if( this.server.testMode )
			{
				throw e;
			}
		}
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
		let room = new Room( owner );
		this.rooms.set( room.roomId, room );
		return [ RoomResult.Success, room ];
	}

	public findRoom( roomId: string )
	{
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

}
