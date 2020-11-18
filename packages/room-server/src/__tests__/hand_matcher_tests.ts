import { HandMatcher, HandSample, MatchResult } from './../hand_matcher';



expect.extend( 
{
	toHaveContexts( actualContexts: any[], expectedContexts: any[] )
	{
		let foundCount = 0;
		for( let context of expectedContexts )
		{
			if( actualContexts.includes( context ) )
			{
				foundCount++;
			}
		}

		let pass: boolean;
		let reason: string;
		if( actualContexts.length != expectedContexts.length )
		{
			pass = false;
			reason = `Actual (${ actualContexts.length }) and expected (${ expectedContexts.length }) lengths don't match`;
		}
		else if( foundCount == expectedContexts.length )
		{
			pass = true;
			reason = `Found (${ foundCount }) of (${ expectedContexts.length }) contexts`;
		}
		else
		{
			pass = false;
			reason = `Only found (${ foundCount }) of (${ expectedContexts.length }) contexts`;
		}

		return {
			message: () => reason,
			pass,
		};
	}
} );

declare global 
{
	namespace jest 
	{
		interface Matchers<R> 
		{
			toHaveContexts( context: any[] ): R;
		}
	}
}

jest.useFakeTimers();

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

describe( "HandMatcher ", () =>
{
	let matcher: HandMatcher;
	let calls: Call[];
	let now: number;

	beforeEach( async() =>
	{
		calls = [];
		matcher = new HandMatcher( ( result: MatchResult, contexts: any[] ) =>
		{
			calls.push( { result, contexts } );
		} );
		now = 1000;
	} );

	afterEach( async () =>
	{
		matcher = null;
		calls = null;
		jest.clearAllTimers();
	} );

	const addTime = ( ms: number ) =>
	{
		now += ms;
		jest.advanceTimersByTime( ms );
	}

	Date.now = jest.fn( () => now );

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
		expect( calls[0].contexts ).toHaveContexts( [ s1.context ] );
	} );

	it( "simple match", () =>
	{
		let s1 = sample( 3, 4, 2 );
		let s2 = sample( 4, 3, 2 );
		expect( s2.context ).not.toBe( s1.context );

		matcher.addSample( s1 );
		expect( calls.length ).toBe( 0 );
		matcher.addSample( s2 );
		expect( calls.length ).toBe( 1 );
		expect( calls[0].result ).toBe( MatchResult.Matched );
		expect( calls[0].contexts ).toHaveContexts( [ s1.context, s2.context ] );
	} );

	it( "timeout", () =>
	{
		let s1 = sample( 3, 4, 2 );

		matcher.addSample( s1 );
		expect( calls.length ).toBe( 0 );

		addTime( 5000 );

		expect( calls.length ).toBe( 1 );
		expect( calls[0].result ).toBe( MatchResult.TimedOut );
		expect( calls[0].contexts ).toHaveContexts( [ s1.context ] );
	} );

	it( "match with delta", () =>
	{
		let s1 = sample( 3, 4, 2 );
		let s2 = sample( 4.01, 2.99, 1.01 );
		let s3 = sample( 4.01, 2.99, 2.01 );

		matcher.addSample( s1 );
		matcher.addSample( s2 );
		expect( calls.length ).toBe( 0 );
		matcher.addSample( s3 );
		expect( calls.length ).toBe( 1 );
		expect( calls[0].result ).toBe( MatchResult.Matched );
		expect( calls[0].contexts ).toHaveContexts( [ s1.context, s3.context ] );
		calls = [];

		addTime( 5000 )
		expect( calls.length ).toBe( 1 );
		expect( calls[0].result ).toBe( MatchResult.TimedOut );
		expect( calls[0].contexts ).toHaveContexts( [ s2.context ] );
	} );


} );



