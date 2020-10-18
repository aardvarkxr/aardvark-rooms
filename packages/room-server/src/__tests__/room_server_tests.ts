import { RoomMessage } from '@aardvarkxr/room-shared';
import { RoomServer } from './../room_server_main';
import { MessageType, AardvarkPort, MsgSetEndpointType, EndpointType, Envelope, MsgSetEndpointTypeResponse, MsgGetAardvarkManifest, MsgGeAardvarkManifestResponse } from '@aardvarkxr/aardvark-shared';
import bind from 'bind-decorator';
import WebSocket = require('ws' );


jest.useRealTimers();

let server: RoomServer|null = null;

beforeEach( async() =>
{
	server = new RoomServer();
	await server.init();

} );

afterEach( async () =>
{
	await server?.cleanup();
	server = null;
} );


class RoomTestClient
{
	public ws = new WebSocket( `ws://localhost:${ server?.portNumber }` );
	public connected = false;
	public connectResolves: ( ( res: boolean )=>void )[] = [];

	public messages: RoomMessage[] = [];

	constructor( )
	{

		this.ws.onopen = this.onConnect;
		this.ws.onmessage = this.onMessage;
		this.ws.onerror = this.onError;
	}

	@bind
	public onMessage( event: WebSocket.MessageEvent )
	{
		let msg = JSON.parse( event.data as string ) as RoomMessage;
		this.messages.push( msg );
	}

	@bind
	private onConnect( )
	{
		this.connected = true;

		for( let resolve of this.connectResolves )
		{
			resolve( true );
		}
		this.connectResolves = [];
	}

	@bind
	private onError( evt: WebSocket.ErrorEvent )
	{
		if( !this.connected )
		{
			for( let resolve of this.connectResolves )
			{
				resolve( false );
			}
			this.connectResolves = [];
		}
	}
	
	public waitForConnect() : Promise<boolean>
	{
		return new Promise<boolean>( (resolve, reject) =>
		{
			if( this.connected )
			{
				resolve( true );
			}

			this.connectResolves.push( resolve );
		} );
	}

	public close()
	{
		this.ws?.close();
	}
}


describe( "RoomServer ", () =>
{
	it( "connect", async ( done ) =>
	{
		let client = new RoomTestClient();
		let res = await client.waitForConnect();

		expect( res ).toBe( true );
		client.close();
		done();
	} );

	it( "connect2", async ( done ) =>
	{
 		let addr = `ws://localhost:${ server?.portNumber }`;

		let client = new WebSocket( addr );
		client.on( 'error', (sock:WebSocket, code: number, reason: string ) =>
		{
			throw new Error( reason );
		} );

		let p = new Promise<void>( ( resolve, reject ) =>
		{
			client.onopen = (evt: WebSocket.OpenEvent ) => { resolve() } ;
		} );

		await p;

		client.close();
		done();
	} );


} );



