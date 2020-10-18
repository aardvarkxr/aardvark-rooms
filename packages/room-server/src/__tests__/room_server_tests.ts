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

	public async createRoom()
	{
		await this.waitForConnect();

		let createMsg: RoomMessage =
		{
			type: RoomMessageType.CreateRoom,
		};

		this.sendMessage( createMsg );

		let resp = await this.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.CreateRoomResponse );
		return resp?.roomId;
	}

	public async joinRoom( roomId: string )
	{
		await this.waitForConnect();

		let joinMsg: RoomMessage =
		{
			type: RoomMessageType.JoinRoom,
			roomId,
		};

		this.sendMessage( joinMsg );

		let resp = await this.waitForMessage();
		return resp?.result ?? RoomResult.UnknownFailure;
	}

	public async leaveRoom( roomId: string )
	{
		await this.waitForConnect();

		let leaveMsg: RoomMessage =
		{
			type: RoomMessageType.LeaveRoom,
			roomId,
		};

		this.sendMessage( leaveMsg );

		let resp = await this.waitForMessage();
		return resp?.result ?? RoomResult.UnknownFailure;
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


	it( "create room", async ( done ) =>
	{
		let client = new RoomTestClient();
		await client.waitForConnect();

		let createMsg: RoomMessage =
		{
			type: RoomMessageType.CreateRoom,
		};

		client.sendMessage( createMsg );

		let resp = await client.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.CreateRoomResponse );
		expect( resp?.result ).toBe( RoomResult.Success );
		expect( typeof resp?.roomId ).toBe( "string" );

		expect( resp?.roomId ).not.toBe( "" );
		
		client.close();
		done();
	} );


	it( "join room", async ( done ) =>
	{
		let client = new RoomTestClient();
		let roomId = await client.createRoom();

		let joinMsg: RoomMessage =
		{
			type: RoomMessageType.JoinRoom,
			roomId,
		};

		client.sendMessage( joinMsg );

		let resp = await client.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.JoinRoomResponse );
		expect( resp?.result ).toBe( RoomResult.Success );

		client.close();
		done();
	} );

	it( "join twice", async ( done ) =>
	{
		let client = new RoomTestClient();
		let roomId = await client.createRoom() as string;

		expect( typeof roomId ).toBe( "string" );
		expect( await client.joinRoom( roomId ) ).toBe( RoomResult.Success );
		expect( await client.joinRoom( roomId ) ).toBe( RoomResult.AlreadyInThisRoom );

		client.close();
		done();
	} );

	it( "leave room", async ( done ) =>
	{
		let client = new RoomTestClient();
		let roomId = await client.createRoom() as string;

		expect( await client.joinRoom( roomId ) ).toBe( RoomResult.Success );

		let leaveMsg: RoomMessage =
		{
			type: RoomMessageType.LeaveRoom,
			roomId,
		};

		client.sendMessage( leaveMsg );

		let resp = await client.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.LeaveRoomResponse );
		expect( resp?.result ).toBe( RoomResult.Success );

		client.close();
		done();
	} );

	it( "leave when not joined", async ( done ) =>
	{
		let client = new RoomTestClient();
		let roomId = await client.createRoom() as string;

		expect( await client.leaveRoom( roomId ) ).toBe( RoomResult.UnknownMember );
		expect( await client.joinRoom( roomId ) ).toBe( RoomResult.Success );
		expect( await client.leaveRoom( roomId ) ).toBe( RoomResult.Success );
		expect( await client.leaveRoom( roomId ) ).toBe( RoomResult.UnknownMember );

		client.close();
		done();
	} );


} );



