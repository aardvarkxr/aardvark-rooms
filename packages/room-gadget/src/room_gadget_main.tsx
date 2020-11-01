import { AvOrigin, AvPanel, AvStandardGrabbable, AvTransform, DefaultLanding, GrabbableStyle } from '@aardvarkxr/aardvark-react';
import { Av, g_builtinModelBox } from '@aardvarkxr/aardvark-shared';
import { RoomResult, RoomMessage, RoomMessageType } from '@aardvarkxr/room-shared';
import bind from 'bind-decorator';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import WebSocket from 'ws';

interface SimpleRoomState
{
}

class RoomClient
{
	public ws: WebSocket;
	public connected = false;
	public connectResolves: ( ( res: boolean )=>void )[] = [];

	public messages: RoomMessage[] = [];
	public messageResolve: ( ( msg: RoomMessage )=>void ) | null = null;

	constructor( addr: string )
	{
		this.ws = new WebSocket( addr );

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

	public async destroyRoom( roomId: string )
	{
		await this.waitForConnect();

		let destroyMsg: RoomMessage =
		{
			type: RoomMessageType.DestroyRoom,
			roomId,
		}
		this.sendMessage( destroyMsg );

		let resp = await this.waitForMessage();
		expect( resp?.type ).toBe( RoomMessageType.DestroyRoomResponse );

		return resp?.result;
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


class SimpleRoom extends React.Component< {}, SimpleRoomState >
{
	private m_grabbableRef = React.createRef<AvStandardGrabbable>();

	constructor( props: any )
	{
		super( props );
		this.state = 
		{ 
		};
	}

	public componentDidMount()
	{
	}

	public componentWillUnmount()
	{
	}

	public renderPanel()
	{
		return <>
			<div className="Button">Join Room</div>
		</>;
	}

	public render()
	{
		return (
			<AvStandardGrabbable modelUri={ g_builtinModelBox } modelScale={ 0.03 } 
				modelColor="lightblue" style={ GrabbableStyle.Gadget } ref={ this.m_grabbableRef }>
				<AvTransform translateY={ 0.08 } >
					<AvPanel interactive={true} widthInMeters={ 0.1 }/>
				</AvTransform>
				<AvOrigin path="/user/hand/right"/>
				<AvOrigin path="/user/hand/left"/>
			</AvStandardGrabbable> );
	}

}

let main = Av() ? <SimpleRoom/> : <DefaultLanding/>
ReactDOM.render( main, document.getElementById( "root" ) );
