import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import { RoomServer } from './../room_server_main';
import bind from 'bind-decorator';
import WebSocket = require('ws' );


jest.useRealTimers();

let server: RoomServer|null = null;

beforeEach( async() =>
{
	server = new RoomServer( undefined, { testMode: true } );
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
	public messageResolve: ( ( msg: RoomMessage )=>void ) | null = null;

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
		if( this.messageResolve )
		{
			let res = this.messageResolve;
			this.messageResolve = null;
			res( msg );
		}
		else
		{
			this.messages.push( msg );
		}
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

	public async sendMessage( msg: RoomMessage )
	{
		if( !await this.waitForConnect() )
			return false;

		this.ws.send( JSON.stringify( msg ) );
		return true;
	}

	public waitForMessage()
	{
		return new Promise< RoomMessage | null >( (resolve, reject) =>
		{
			if( !this.connected )
			{
				reject( "Can only wait for messages on connected clients" );
				return;
			}

			if( this.messageResolve )
			{
				reject( "Somebody is already waiting on a message from this client" );
				return;
			}

			if( this.messages.length > 0 )
			{
				let msg = this.messages[0];
				this.messages.splice( 0, 1 );
			}
			else
			{
				this.messageResolve = resolve;
			}
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

	it( "nonexistent room", async ( done ) =>
	{
		let client = new RoomTestClient();
		await client.waitForConnect();

		let joinMsg: RoomMessage =
		{
			type: RoomMessageType.JoinRoom,
			roomId: "fred",
		};

		client.sendMessage( joinMsg );

		let resp = await client.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.JoinRoomResponse );
		expect( resp?.result ).toBe( RoomResult.NoSuchRoom );
		
		client.close();
		done();
	} );


} );



