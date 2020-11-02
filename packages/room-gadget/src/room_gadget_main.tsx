import { AvComposedEntity, AvOrigin, AvPanel, AvStandardGrabbable, AvTransform, DefaultLanding, GrabbableStyle, NetworkUniverseComponent, RemoteUniverseComponent } from '@aardvarkxr/aardvark-react';
import { Av, AvNodeTransform, emptyVolume, g_builtinModelBox, infiniteVolume } from '@aardvarkxr/aardvark-shared';
import { RoomResult, RoomMessage, RoomMessageType } from '@aardvarkxr/room-shared';
import bind from 'bind-decorator';
import * as React from 'react';
import * as ReactDOM from 'react-dom';

interface MessageHandler
{
	( msg: RoomMessage ): void;
}

class RoomClient
{
	public ws: WebSocket;
	public connected = false;
	private connectionCallback: () => void;

	public messages: RoomMessage[] = [];
	public messageResolve: ( ( msg: RoomMessage )=>void ) | null = null;

	public messageHanders: { [ type: number ]: MessageHandler } = {};

	constructor( addr: string, callback: () => void, messageHandlers: { [ type: number ]: MessageHandler } )
	{
		this.ws = new WebSocket( addr );

		this.connectionCallback = callback;
		this.messageHanders = messageHandlers;

		this.ws.onopen = this.onConnect;
		this.ws.onmessage = this.onMessage;
		this.ws.onerror = this.onError;
	}

	@bind
	public onMessage( event: MessageEvent )
	{
		let msg = JSON.parse( event.data as string ) as RoomMessage;
		
		console.log( "Received message of type ", RoomMessageType[ msg.type ] );

		let handler = this.messageHanders[ msg.type ];
		if( handler )
		{
			handler( msg );
			return;
		}

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

		this.connectionCallback?.();
	}

	@bind
	private onError( evt: Event )
	{
	}
	
	public async sendMessage( msg: RoomMessage )
	{
		if( !this.connected )
			return false;

		console.log( "Sent message of type ", RoomMessageType[ msg.type ] );
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
				console.log( "Waiting for message..." );
				this.messageResolve = resolve;
			}
		} );
	}

	public async createRoom(): Promise<RoomResult | string>
	{
		if( !this.connected )
			return RoomResult.Disconnected;


		let createMsg: RoomMessage =
		{
			type: RoomMessageType.CreateRoom,
		};

		this.sendMessage( createMsg );

		let resp = await this.waitForMessage();
		return resp?.roomId;
	}

	public async destroyRoom( roomId: string ): Promise<RoomResult>
	{
		if( !this.connected )
			return RoomResult.Disconnected;


		let destroyMsg: RoomMessage =
		{
			type: RoomMessageType.DestroyRoom,
			roomId,
		}
		this.sendMessage( destroyMsg );

		let resp = await this.waitForMessage();
		return resp?.result;
	}

	public async joinRoom( roomId: string ): Promise<RoomResult>
	{
		if( !this.connected )
			return RoomResult.Disconnected;


		let joinMsg: RoomMessage =
		{
			type: RoomMessageType.JoinRoom,
			roomId,
		};

		this.sendMessage( joinMsg );

		let resp = await this.waitForMessage();
		return resp?.result ?? RoomResult.UnknownFailure;
	}

	public async leaveRoom( roomId: string ): Promise<RoomResult>
	{
		if( !this.connected )
			return RoomResult.Disconnected;


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

interface SimpleRoomProps
{
	roomId: string;
	serverAddress: string;
	transform: AvNodeTransform;
}

interface SimpleRoomState
{
	connected: boolean;
	joined: boolean;
}

class SimpleRoom extends React.Component< SimpleRoomProps, SimpleRoomState >
{
	private client: RoomClient;
	private networkUniverse = new NetworkUniverseComponent( this.onNetworkEvent );
	private remoteUniverses: { [memberId: number]: RemoteUniverseComponent } = {};

	constructor( props: any )
	{
		super( props );
		this.state = 
		{ 
			connected: false,
			joined: false,
		};
		this.client = new RoomClient( 
			this.props.serverAddress, this.onConnectionStateChange,
			{
				[ RoomMessageType.MessageFromPrimary ]: this.onMessageFromPrimary,
				[ RoomMessageType.MessageFromSecondary ]: this.onMessageFromSecondary,
				[ RoomMessageType.EjectedFromRoom ]: this.onEjectedFromRoom,
				[ RoomMessageType.RequestMemberInfo ]: this.onRequestMemberInfo,
				[ RoomMessageType.AddRemoteMember ]: this.onAddRemoteMember,
				[ RoomMessageType.MemberLeft ]: this.onMemberLeft,

			} );
	}

	@bind
	private async onConnectionStateChange()
	{
		let newlyConnected = !this.state.connected && this.client.connected;
		this.setState( { connected: this.client.connected } );
		if( newlyConnected )
		{
			let res = await this.client.joinRoom( this.props.roomId );
			if( res == RoomResult.Success )
			{
				this.setState(
					{
						joined: true,
					}
				);
			}
			else
			{
				this.setState(
					{
						joined: false,
					}
				);
			}
				}
	}

	@bind
	private onNetworkEvent( event: object, reliable: boolean )
	{
		let msg: RoomMessage =
		{
			type: RoomMessageType.MessageFromPrimary,
			roomId: this.props.roomId,
			messageIsReliable: reliable,
			message: event,
		}

		this.client.sendMessage( msg );
	}

	@bind
	private onMessageFromPrimary( msg: RoomMessage )
	{
		let remoteUniverse = this.remoteUniverses[ msg.memberId ];
		if( !remoteUniverse )
		{
			console.log( "Received MessageFromPrimary for unknown remote universe", msg.memberId );
			return;
		}

		remoteUniverse.networkEvent( msg.message );
	}
	
	@bind
	private onMessageFromSecondary( msg: RoomMessage )
	{
		this.networkUniverse.remoteEvent( msg.message );
	}
	
	@bind
	private onEjectedFromRoom( msg: RoomMessage )
	{
		this.remoteUniverses = {};
	}
	
	@bind
	private onRequestMemberInfo( msg: RoomMessage )
	{
		let response: RoomMessage =
		{
			type: RoomMessageType.RequestMemberResponse,
			roomId: this.props.roomId,
			initInfo: this.networkUniverse.initInfo,
		}

		this.client.sendMessage( response );
	}
	
	@bind
	private onAddRemoteMember( msg: RoomMessage )
	{
		if( this.remoteUniverses[ msg.memberId ] )
		{
			console.log( "Received AddRemoteMember for member which already existed. Discarding the old member",
				msg.memberId );
			delete this.remoteUniverses[ msg.memberId ];
		}

		let memberId = msg.memberId;
		this.remoteUniverses[ msg.memberId ] = new RemoteUniverseComponent( msg.initInfo,
			( evt: object, reliable: boolean ) => { this.sendSecondaryMessage( memberId, evt, reliable ) } );
		this.forceUpdate();
	}
	
	private sendSecondaryMessage( memberId: number, evt: object, reliable: boolean )
	{
		let msg: RoomMessage =
		{
			type: RoomMessageType.MessageFromSecondary,
			roomId: this.props.roomId,
			memberId,
			message: evt,
			messageIsReliable: reliable,
		};

		this.client.sendMessage( msg );
	}

	@bind
	private onMemberLeft( msg: RoomMessage )
	{
		delete this.remoteUniverses[ msg.memberId ];
		this.forceUpdate();
	}
	

	render()
	{
		if( !this.state.joined )
			return null;

		let remotes: JSX.Element[] = [];
		for( let memberId in this.remoteUniverses )
		{
			remotes.push( <AvComposedEntity volume={ emptyVolume() } 
				debugName={ `Remote member ${ memberId }`} 
				key={ memberId }
				components={ [ this.remoteUniverses[ memberId ] ] }
				/> )
		}

		return (
			<AvOrigin path="/space/stage">
				<AvComposedEntity components={ [ this.networkUniverse ] }
					volume={ infiniteVolume() } debugName="Hand mirror network universe"/> 
				<AvTransform transform={ this.props.transform }>
					{ remotes }
				</AvTransform>
			</AvOrigin> );
	}

}

interface SimpleRoomUIProps
{
	serverAddress: string;
}


interface SimpleRoomUIState
{
	connected: boolean;
	createdRoom?: string;
	error?: string;
	joined: boolean;
}

class SimpleRoomUI extends React.Component< SimpleRoomUIProps, SimpleRoomUIState >
{
	private m_grabbableRef = React.createRef<AvStandardGrabbable>();
	private client: RoomClient;

	constructor( props: any )
	{
		super( props );

		this.state = 
		{
			joined: false,
			connected: false,
		};

		this.client = new RoomClient( this.props.serverAddress, this.onConnectionStateChange, {} );
	}

	@bind
	private async onConnectionStateChange()
	{
		let newlyConnected = !this.state.connected && this.client.connected;
		this.setState( { connected: this.client.connected, createdRoom: null } );
		if( newlyConnected )
		{
			// try to make our room
			let res = await this.client.createRoom();
			if( typeof res == "string" )
			{
				this.setState( { createdRoom: res as string } );
			}
			else
			{
				this.setState( { error: `Failed to create room: ${ RoomResult[ res as number ] }` } );
			}
		}
	}

	@bind
	private async onJoinRoom()
	{
		let res = await this.client.joinRoom( this.state.createdRoom );
		if( res == RoomResult.Success )
		{
			this.setState(
				{
					joined: true,
					error: null,
				}
			);
		}
		else
		{
			this.setState(
				{
					error: `Join failed with ${ RoomResult[ res ] }`,
				}
			);
		}

	}

	@bind
	private async onLeaveRoom()
	{
		let res = await this.client.leaveRoom( this.state.createdRoom );
		if( res == RoomResult.Success )
		{
			this.setState(
				{
					joined: false,
					error: null,
				}
			);
		}
		else
		{
			this.setState(
				{
					error: `Leave failed with ${ RoomResult[ res ] }`,
				}
			);
		}
	}
	private renderPanel()
	{
		if( !this.state.connected )
		{
			return <>
				<div className="Label">Connecting to server...</div>
				{ this.state.error && <div className="Label">Error: {this.state.error }</div> }
				</>;
		}

		if( this.state.joined )
		{
			return <>
				<div className="Button" onClick={ this.onLeaveRoom }>Leave Room</div>
				<div className="Label">Connected to room: { this.state.createdRoom }</div>
				{ this.state.error && <div className="Label">Error: {this.state.error }</div> }
			</>;
		}
		else if( this.state.createdRoom )
		{
			return <>
				<div className="Button" onClick={ this.onJoinRoom }>Join Room</div>
				{ this.state.error && <div className="Label">Error: {this.state.error }</div> }
			</>;
		}
		else
		{
			return <>
				{ this.state.error && <div className="Label">Error: {this.state.error }</div> }
			</>;
		}
	}

	public render()
	{
		return (
			<AvStandardGrabbable modelUri={ g_builtinModelBox } modelScale={ 0.03 } 
				modelColor="lightblue" style={ GrabbableStyle.Gadget } ref={ this.m_grabbableRef }>
				<AvTransform translateY={ 0.08 } >
					<AvPanel interactive={true} widthInMeters={ 0.1 }>
						{ this.renderPanel() }
					</AvPanel>
				</AvTransform>
				<AvOrigin path="/user/hand/right"/>
				<AvOrigin path="/user/hand/left"/>
				{ this.state.joined && <>
						<SimpleRoom roomId={ this.state.createdRoom } transform={ {} } 
							serverAddress={ this.props.serverAddress } key="self"/>
						<SimpleRoom roomId={ this.state.createdRoom } 
							transform={ { position: { x: 0, y: 1, z: 0 } } } 
							serverAddress={ this.props.serverAddress } key="mirror"/>
					</> }
			</AvStandardGrabbable> );
	}

}

let main = Av() ? <SimpleRoomUI serverAddress="ws://localhost:18080" /> : <DefaultLanding/>
ReactDOM.render( main, document.getElementById( "root" ) );
