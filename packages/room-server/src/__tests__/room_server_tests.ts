import { AvVector, AvNodeTransform } from '@aardvarkxr/aardvark-shared';
import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import { RoomServer } from '../room_server';
import bind from 'bind-decorator';
import WebSocket = require('ws' );


jest.useRealTimers();


class RoomTestClient
{
	public ws: WebSocket;
	public connected = false;
	public connectResolves: ( ( res: boolean )=>void )[] = [];
	public roomId: string;
	public roomFromMember: AvNodeTransform;
	public messages: RoomMessage[] = [];
	public messageResolve: ( ( msg: RoomMessage )=>void ) | null = null;

	constructor( server: RoomServer )
	{
		this.ws = new WebSocket( `ws://localhost:${ server?.portNumber }` );

		this.ws.onopen = this.onConnect;
		this.ws.onmessage = this.onMessage;
		this.ws.onerror = this.onError;
	}

	@bind
	public onMessage( event: WebSocket.MessageEvent )
	{
		let msg = JSON.parse( event.data as string ) as RoomMessage;

		if( msg.type == RoomMessageType.UpdateRoomInfo )
		{
			this.roomId = msg.roomId;
			this.roomFromMember = msg.roomFromMember;

			for( let resolve of this.connectResolves )
			{
				resolve( true );
			}
			this.connectResolves = [];
		}
		else if( this.messageResolve )
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

			let msg = this.messages.shift();
			if( msg )
			{
				resolve( msg );
			}
			else
			{
				this.messageResolve = resolve;
			}
		} );
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

	public async joinRoomWithMatch( leftHandPosition: AvVector, rightHandPosition: AvVector )
	{
		await this.waitForConnect();

		let joinMsg: RoomMessage =
		{
			type: RoomMessageType.JoinRoomWithMatch,
			leftHandPosition,
			rightHandPosition,
		};

		this.sendMessage( joinMsg );

		let resp = await this.waitForMessage();
		return [ resp?.result ?? RoomResult.UnknownFailure, resp.roomId ];
	}

	public close()
	{
		this.ws?.close();
	}
}


describe( "RoomServer ", () =>
{
	let server: RoomServer;

	beforeEach( async() =>
	{
		server = new RoomServer( undefined, { testMode: true } );
		await server.init();

	} );

	afterEach( async () =>
	{
		await server?.cleanup();
		( server as any) = undefined;
	} );


	it( "connect", async ( done ) =>
	{
		let client = new RoomTestClient( server );
		let res = await client.waitForConnect();

		expect( res ).toBe( true );
		client.close();
		done();
	} );

	it( "nonexistent room", async ( done ) =>
	{
		let client = new RoomTestClient( server );
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

		expect( client.roomId ).not.toBe( "fred" );
		
		client.close();
		done();
	} );


	it( "join room", async ( done ) =>
	{
		let client1 = new RoomTestClient( server );
		let client2 = new RoomTestClient( server );
		expect( await client1.waitForConnect() ).toBe( true );
		expect( await client2.waitForConnect() ).toBe( true );

		let joinMsg: RoomMessage =
		{
			type: RoomMessageType.JoinRoom,
			roomId: client2.roomId,
		};

		client1.sendMessage( joinMsg );

		let resp = await client1.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.JoinRoomResponse );
		expect( resp?.result ).toBe( RoomResult.Success );

		client1.close();
		client2.close();
		done();
	} );

	it( "join twice", async ( done ) =>
	{
		let client = new RoomTestClient( server );
		await client.waitForConnect();

		expect( typeof client.roomId ).toBe( "string" );
		expect( await client.joinRoom( client.roomId ) ).toBe( RoomResult.AlreadyInThisRoom );

		client.close();
		done();
	} );

	it( "two members", async ( done ) =>
	{
		let client1 = new RoomTestClient( server );
		await client1.waitForConnect();
		let roomId = client1.roomId;
		let client2 = new RoomTestClient( server );
		await client2.waitForConnect();

		expect( await client2.joinRoom( roomId ) ).toBe( RoomResult.Success );

		let infoRequestMessage = await client1.waitForMessage();
		expect( infoRequestMessage?.type ).toBe( RoomMessageType.RequestMemberInfo );
		expect( infoRequestMessage?.roomId ).toBe( roomId );
		
		let infoRequestMessage2 = await client2.waitForMessage();
		expect( infoRequestMessage2?.type ).toBe( RoomMessageType.RequestMemberInfo );
		expect( infoRequestMessage2?.roomId ).toBe( roomId );
		
		let initInfoMsg1: RoomMessage =
		{
			type: RoomMessageType.RequestMemberResponse,
			roomId,
			initInfo: { frodo: "sam" },
		}
		client1.sendMessage( initInfoMsg1 );

		let addRemote2 = await client2.waitForMessage();
		expect( addRemote2?.roomId ).toBe( roomId );
		expect( addRemote2?.type ).toBe( RoomMessageType.AddRemoteMember );
		expect( ( addRemote2?.initInfo as any)?.frodo ).toBe( "sam" );
		expect( typeof addRemote2?.memberId ).toBe( "number" );

		let client1MemberId = addRemote2?.memberId ?? 0;

		let initInfoMsg2: RoomMessage =
		{
			type: RoomMessageType.RequestMemberResponse,
			roomId,
			initInfo: { merry: "pippen" },
		}
		client2.sendMessage( initInfoMsg2 );

		let addRemote1 = await client1.waitForMessage();
		expect( addRemote1?.roomId ).toBe( roomId );
		expect( addRemote1?.type ).toBe( RoomMessageType.AddRemoteMember );
		expect( ( addRemote1?.initInfo as any)?.merry ).toBe( "pippen" );

		let p2s: RoomMessage =
		{
			type: RoomMessageType.MessageFromPrimary,
			roomId,
			message: { cargo: "the one ring" },
		};

		client1.sendMessage( p2s );

		let p2sBounce = await client2.waitForMessage();
		expect( p2sBounce?.type ).toBe( RoomMessageType.MessageFromPrimary );
		expect( p2sBounce?.roomId ).toBe( roomId );
		expect( p2sBounce?.memberId ).toBe( client1MemberId );
		expect( ( p2sBounce?.message as any)?.cargo ).toBe( "the one ring" );

		let s2p: RoomMessage =
		{
			type: RoomMessageType.MessageFromSecondary,
			roomId,
			memberId: client1MemberId,
			message: { my: "pressshhhhuuusss" },
			messageIsReliable: true,
		};

		client2.sendMessage( s2p );

		let s2pBounce = await client1.waitForMessage();
		expect( s2pBounce?.type ).toBe( RoomMessageType.MessageFromSecondary );
		expect( s2pBounce?.roomId ).toBe( roomId );
		expect( s2pBounce?.memberId ).toBe( client1MemberId );
		expect( ( s2pBounce?.message as any)?.my ).toBe( "pressshhhhuuusss" );

		// leaving the room should cause the other end to lose us as a member
		client1.close();

		let memberLeft = await client2.waitForMessage();
		expect( memberLeft?.type ).toBe( RoomMessageType.MemberLeft );
		expect( memberLeft?.memberId ).toBe( client1MemberId );
		expect( memberLeft?.roomId ).toBe( roomId );

		client2.close();
		done();
	} );

	it( "two members via match", async ( done ) =>
	{
		let client1 = new RoomTestClient( server );
		let client2 = new RoomTestClient( server );
		await client1.waitForConnect();
		await client2.waitForConnect();

		let h1: AvVector = { x: 3, y: 4, z: 5 };
		let h2: AvVector = { x: 5, y: 4, z: 3 };

		let j1 = client1.joinRoomWithMatch( h1, h2 );
		let j2 = client2.joinRoomWithMatch( h2, h1 );

		let [ r1, roomId1 ] = await j1;
		let [ r2, roomId2 ] = await j2;

		expect( r1 ).toBe( RoomResult.Success );
		expect( r2 ).toBe( RoomResult.Success );
		expect( roomId1 ).toBe( roomId2 );
		expect( roomId1 ).not.toBeNull();

		let infoRequestMessage = await client1.waitForMessage();
		expect( infoRequestMessage?.type ).toBe( RoomMessageType.RequestMemberInfo );
		expect( infoRequestMessage?.roomId ).toBe( roomId1 );
		
		let infoRequestMessage2 = await client2.waitForMessage();
		expect( infoRequestMessage2?.type ).toBe( RoomMessageType.RequestMemberInfo );
		expect( infoRequestMessage2?.roomId ).toBe( roomId1 );
		
		client1.close();
		client2.close();
		done();
	} );


} );



