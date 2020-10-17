import bind from 'bind-decorator';
import express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';


class Room
{

}

export class RoomServer
{

	private m_app = express();
	private m_server = http.createServer( this.m_app );
	private m_wss:WebSocket.Server;
	private m_nextConnectionId = 27;

	constructor( port: number )
	{
		this.m_wss = new WebSocket.Server( { server: this.m_server } );

		this.m_server.on( 'error', ( e:NodeJS.ErrnoException ) =>
		{
			if( e.code === 'EADDRINUSE' )
			{
				console.log( `Can't listen on port ${port}. Exiting` );
				process.exit( -100 );
			}
		} );

		this.m_server.listen( port, () => 
		{
			console.log(`Room Server started on port ${ port } :)`);

			this.m_wss.on('connection', this.onConnection );
		} );
	}

	async init()
	{
	}

	@bind onConnection( ws: WebSocket, request: http.IncomingMessage )
	{
		
	}
}
