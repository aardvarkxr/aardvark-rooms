import { RoomServer } from './../room_server_main';
import { MessageType, AardvarkPort, MsgSetEndpointType, EndpointType, Envelope, MsgSetEndpointTypeResponse, MsgGetAardvarkManifest, MsgGeAardvarkManifestResponse } from '@aardvarkxr/aardvark-shared';
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


describe( "RoomServer ", () =>
{
	it( "connect", async ( done ) =>
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



