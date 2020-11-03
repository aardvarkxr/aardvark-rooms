import { HandMatcher, HandSample, MatchResult } from './../hand_matcher';
import { RoomMessage, RoomMessageType, RoomResult } from '@aardvarkxr/room-shared';
import { RoomServer } from '../room_server';
import bind from 'bind-decorator';
import WebSocket = require('ws' );


jest.useRealTimers();



interface Call
{
	result: MatchResult;
	contexts: any[];
}

let nextContext: number = 1;
function sample( leftHeight: number, rightHeight: number, distance: number, context?: any ): HandSample
{
	return {
		leftHeight, rightHeight, distance,
		context: context ?? nextContext++,
	};
}

describe( "RoomServer ", () =>
{
	let matcher: HandMatcher;
	let calls: Call[];

	beforeEach( async() =>
	{
		calls = [];
		matcher = new HandMatcher( ( result: MatchResult, contexts: any[] ) =>
		{
			calls.push( { result, contexts } );
		} );
	} );

	afterEach( async () =>
	{
		matcher = null;
		calls = null;
	} );


	it( "replacement", () =>
	{
		let s1 = sample( 3, 4, 2 );
		let s2 = sample( 4, 5, 2, s1.context );
		expect( s2.context ).toBe( s1.context );

		matcher.addSample( s1 );
		expect( calls.length ).toBe( 0 );
		matcher.addSample( s2 );
		expect( calls.length ).toBe( 1 );
		expect( calls[0].result ).toBe( MatchResult.Replaced );
		expect( calls[0].contexts.length ).toBe( 1 );
		expect( calls[0].contexts[0] ).toBe( s1.context );

	} );


} );



