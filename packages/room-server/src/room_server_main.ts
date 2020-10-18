import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import bind from 'bind-decorator';
import express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';


class Room
{

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

		this.handlers[ /*RoomMessageType.JoinRoom */ 100] = this.onMsgJoinRoom;
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
			console.log( `Exception when processing message`, evt );
		}
	}

	@bind 
	private onMsgJoinRoom( msg: RoomMessage )
	{
		// there aren't rooms yet
		let result: RoomMessage =
		{
			type: RoomMessageType.JoinRoomResponse,
			result: RoomResult.NoSuchRoom,
		};

		this.sendMessage( result );
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
		this.server.close();
		// return new Promise<void>( ( resolve, reject ) =>
		// {
		// 	this.server.close( () =>
		// 	{
		// 		resolve();
		// 	} );
		// } )
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
}
