import { AvVector } from "@aardvarkxr/aardvark-shared";
import bind from "bind-decorator";

export interface HandSample
{
	/** height of the left hand off the floor */
	leftHeight: number;

	/** height of the right hand off the floor */
	rightHeight: number;

	/** distance from the left hand to the right hand */
	distance: number;

	/** The context identifier for this sample. When responding about
	 * a sample or set of samples the matcher will use this context 
	 * to identify samples
	 */
	context: any;

	/** The time when the sample was added to the matcher. */
	timestamp?: number;
}

export enum MatchResult
{
	/** The sample was left unmatched for longer than the timeout period,
	 * and will no longer be considered for future matches
	 */
	TimedOut,

	/** The sample was matched with another sample. Both contexts are 
	 * provided in the contexts argument.
	 */
	Matched,

	/** The sample was replaced with another sample from the same context.
	 * The old sample has been discarded and the new sample will be used instead.
	 */
	Replaced,
}


/** This callback will be called for every sample that  */
interface MatchCallback
{
	( result: MatchResult, contexts: any[] ): void;
}

function nearlyEqual( a: number, b: number, threshold: number )
{
	return Math.abs( a - b ) <= threshold;
}

const k_distanceThreshold = 0.02;
const k_relativeHeightThreshold = 0.02;
const k_absoluteHeightThreshold = 0.02;
const k_sampleTimeoutMs = 1000;

export class HandMatcher
{
	private activeSamples: HandSample[] = [];
	private callback: MatchCallback;

	constructor( callback: MatchCallback )
	{
		this.callback = callback;
		global.setInterval( this.timeoutOldSamples, 100 );
	}

	private findMatchForSample( newSample: HandSample ): null | HandSample
	{
		for( let oldSampleIndex = 0; oldSampleIndex < this.activeSamples.length; oldSampleIndex++ )
		{
			let oldSample = this.activeSamples[ oldSampleIndex ];
			if( nearlyEqual( newSample.distance, oldSample.distance, k_distanceThreshold ) 
				&& nearlyEqual( newSample.rightHeight - newSample.leftHeight, 
					oldSample.leftHeight - oldSample.rightHeight, k_relativeHeightThreshold ) 
				&& nearlyEqual( newSample.leftHeight, oldSample.rightHeight, k_absoluteHeightThreshold ) )
			{
				// Found a match!
				this.activeSamples.splice( oldSampleIndex, 1 );
				return oldSample;
			}
		}	
		return null;
	}

	public addSample( newSample: HandSample )
	{
		for( let oldSampleIndex = 0; oldSampleIndex < this.activeSamples.length; oldSampleIndex++ )
		{
			let oldSample = this.activeSamples[ oldSampleIndex ];
			if( oldSample.context == newSample.context )
			{
				this.activeSamples.splice( oldSampleIndex, 1 );
				this.callback( MatchResult.Replaced, [ oldSample.context ] );
				break;
			}
		}	

		let match = this.findMatchForSample( newSample );
		if( !match )
		{
			// add the sample to the array for future samples to match against
			this.activeSamples.push( { ...newSample, timestamp: Date.now() } );
			return;
		}

		this.callback( MatchResult.Matched, [ newSample.context, match.context ] );
	}	

	@bind
	private timeoutOldSamples()
	{
		let expirationTime = Date.now() - k_sampleTimeoutMs;
		while( this.activeSamples.length > 0 )
		{
			let sample = this.activeSamples[0];
			if( sample.timestamp > expirationTime )
			{
				// samples are inserted in timestamp order, so if we found a non-expiring sample
				// the rest of them won't be expired either
				break;
			}

			this.callback( MatchResult.TimedOut, [ sample.context ] );
			this.activeSamples.shift();
		}
	}
}

