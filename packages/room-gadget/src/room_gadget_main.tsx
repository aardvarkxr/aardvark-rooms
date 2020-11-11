import { ActiveInterface, AvComposedEntity, AvGadget, AvInterfaceEntity, AvOrigin, AvPanel, AvPrimitive, AvStandardGrabbable, AvTransform, DefaultLanding, GrabbableStyle, NetworkUniverseComponent, RemoteUniverseComponent, PrimitiveType } from '@aardvarkxr/aardvark-react';
import { Av, AvNodeTransform, AvVector, EAction, EHand, emptyVolume, EVolumeType, g_builtinModelBox, infiniteVolume, nodeTransformFromMat4, nodeTransformToMat4 } from '@aardvarkxr/aardvark-shared';
import { RoomResult, RoomMessage, RoomMessageType } from '@aardvarkxr/room-shared';
import { mat4, vec4 } from '@tlaukkan/tsm';
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
		
		//console.log( "Received message of type ", RoomMessageType[ msg.type ] );

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

		//console.log( "Sent message of type ", RoomMessageType[ msg.type ] );
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

	public async joinRoomWithMatch( leftHandPosition: AvVector, rightHandPosition: AvVector ): 
		Promise< [ RoomResult, null | string ] >
	{
		if( !this.connected )
			return [ RoomResult.Disconnected, null ];

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

enum SimpleRoomRole
{
	Both,
	Network,
	Remote,
}

interface SimpleRoomProps
{
	/** If roomId is specified the simple room will try to join
	 *  that room.
	 */
	roomId?: string;

	/** If left and right position are specified, the simple room
	 * will try to match-make with that gesture on another user
	 */
	leftPosition?: AvVector;
	rightPosition?: AvVector;

	role: SimpleRoomRole;
	serverAddress: string;
	transform: AvNodeTransform;
	onUpdate?: ()=>void;
}

interface SimpleRoomState
{
	connected: boolean;
	joined: boolean;
	roomId?: string;
	roomFromMember?: AvNodeTransform;
}

interface RemoteMember
{
	universe: RemoteUniverseComponent;
	roomFromMember?: AvNodeTransform;
}

class SimpleRoom extends React.Component< SimpleRoomProps, SimpleRoomState >
{
	private client: RoomClient;
	private networkUniverse = new NetworkUniverseComponent( this.onNetworkEvent );
	private remoteMembers: { [memberId: number]: RemoteMember } = {};

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
				[ RoomMessageType.RoomInfo ] : this.onRoomInfo,

			} );
	}

	public componentDidUpdate( prevProps: SimpleRoomProps, prevState: SimpleRoomState )
	{
		if( prevState.joined != this.state.joined || prevState.roomId != this.state.roomId )
		{
			this.props.onUpdate?.();
		}
	}

	@bind
	private onRoomInfo( msg: RoomMessage )
	{
		this.setState( 
			{
				connected: true,
				roomId: msg.roomId,
				roomFromMember: msg.roomFromMember,
			} );
	}

	@bind
	private async onConnectionStateChange()
	{
		let newlyConnected = !this.state.connected && this.client.connected;
		this.setState( { connected: this.client.connected } );
		if( newlyConnected )
		{
			let res: RoomResult;
			if( this.props.roomId )
			{
				res = await this.client.joinRoom( this.props.roomId );
			}
			else
			{
				let[ result, roomId ] = await this.client.joinRoomWithMatch( this.props.leftPosition, 
					this.props.rightPosition );
				res = result;
				if( res == RoomResult.Success )
				{
					this.setState( { roomId } );
				}
			}
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

	public get roomId(): string
	{
		return this.props.roomId ?? this.state.roomId;
	}

	@bind
	private onNetworkEvent( event: object, reliable: boolean )
	{
		let msg: RoomMessage =
		{
			type: RoomMessageType.MessageFromPrimary,
			roomId: this.roomId,
			messageIsReliable: reliable,
			message: event,
		}

		this.client.sendMessage( msg );
	}

	@bind
	private onMessageFromPrimary( msg: RoomMessage )
	{
		let remoteMember = this.remoteMembers[ msg.memberId ];
		if( !remoteMember )
		{
			console.log( "Received MessageFromPrimary for unknown remote universe", msg.memberId );
			return;
		}

		remoteMember.universe.networkEvent( msg.message );
	}
	
	@bind
	private onMessageFromSecondary( msg: RoomMessage )
	{
		this.networkUniverse.remoteEvent( msg.message );
	}
	
	@bind
	private onEjectedFromRoom( msg: RoomMessage )
	{
		this.remoteMembers = {};
	}
	
	@bind
	private onRequestMemberInfo( msg: RoomMessage )
	{
		let response: RoomMessage =
		{
			type: RoomMessageType.RequestMemberResponse,
			roomId: this.roomId,
			initInfo: this.networkUniverse.initInfo,
		}

		this.client.sendMessage( response );
	}
	
	@bind
	private onAddRemoteMember( msg: RoomMessage )
	{
		if( this.remoteMembers[ msg.memberId ] )
		{
			console.log( "Received AddRemoteMember for member which already existed. Discarding the old member",
				msg.memberId );
			delete this.remoteMembers[ msg.memberId ];
		}

		let memberId = msg.memberId;
		let universe = new RemoteUniverseComponent( msg.initInfo,
			( evt: object, reliable: boolean ) => { this.sendSecondaryMessage( memberId, evt, reliable ) } ); 
		let remoteMember =
		{
			universe,
			roomFromMember: msg.roomFromMember,
		}
		
		this.remoteMembers[ msg.memberId ] = remoteMember;
		this.forceUpdate();
	}
	
	private sendSecondaryMessage( memberId: number, evt: object, reliable: boolean )
	{
		let msg: RoomMessage =
		{
			type: RoomMessageType.MessageFromSecondary,
			roomId: this.roomId,
			memberId,
			message: evt,
			messageIsReliable: reliable,
		};

		this.client.sendMessage( msg );
	}

	@bind
	private onMemberLeft( msg: RoomMessage )
	{
		delete this.remoteMembers[ msg.memberId ];
		this.forceUpdate();
	}

	render()
	{
		if( !this.state.joined )
			return null;

		let remotes: JSX.Element[] = [];
		if( this.props.role == SimpleRoomRole.Both || this.props.role == SimpleRoomRole.Remote )
		{
			for( let memberId in this.remoteMembers )
			{
				let remoteMember = this.remoteMembers[ memberId ];
				remotes.push( 
					<AvTransform key={ memberId } transform={ remoteMember.roomFromMember }>
						<AvComposedEntity volume={ emptyVolume() } 
							debugName={ `Remote member ${ memberId }`} 
							key={ memberId }
							components={ [ remoteMember.universe ] }
							/> 
					</AvTransform>)
			}
		}

		let renderNetwork = this.props.role == SimpleRoomRole.Both 
			|| this.props.role == SimpleRoomRole.Network;
		let roomFromLocalMember = nodeTransformToMat4( this.state.roomFromMember );
		let localMemberFromRoom = roomFromLocalMember.copy( new mat4() ).inverse();

		return (
			<AvOrigin path="/space/stage">
				{ 
					renderNetwork && <AvComposedEntity components={ [ this.networkUniverse ] }
						volume={ infiniteVolume() } debugName="simple room network universe"/> 
				}
				<AvTransform transform={ nodeTransformFromMat4( localMemberFromRoom ) }>
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
	error?: string;
	leftPressed: boolean;
	rightPressed: boolean;

	leftGrab?: ActiveInterface;
	rightGrab?: ActiveInterface;

	leftPosition?: AvVector;
	rightPosition?: AvVector;

	// leftTmpPosition?: AvVector;
	// rightTmpPosition?: AvVector;
}

class SimpleRoomUI extends React.Component< SimpleRoomUIProps, SimpleRoomUIState >
{
	private m_grabbableRef = React.createRef<AvStandardGrabbable>();
	private matchRoom = React.createRef<SimpleRoom>();

	constructor( props: any )
	{
		super( props );

		this.state = 
		{
			leftPressed: false,
			rightPressed: false,
		};

		AvGadget.instance().listenForActionState( EAction.Grab, EHand.Left, 
			() => { 
				this.setState( { leftPressed: true } );
				console.log( "left pressed" );
			}, 
			() => { this.setState( { leftPressed: false, leftGrab: null } ) } );
		AvGadget.instance().listenForActionState( EAction.Grab, EHand.Right, 
			() => 
			{ 
				this.setState( { rightPressed: true } );
				console.log( "right pressed" );
			}, 
			() => { this.setState( { rightPressed: false, rightGrab: null } ) } );
	}

	@bind
	private async onLeaveMatchRoom()
	{
		this.setState(
			{
				leftPosition: null,
				rightPosition: null,
			}
		);
	}

	private renderVector( label: string, pos: AvVector )
	{
		return <div className="Label">
			{ label }: ( { ( pos?.x ?? 0 ).toFixed( 3 ) }, 
			{ ( pos?.y ?? 0 ).toFixed( 3 ) }, { ( pos?.z ?? 0 ).toFixed( 3 ) }, )
		</div>;
	}

	private renderPanel()
	{
		if( this.state.leftPosition && this.state.rightPosition )
		{
			return <>
				<div className="Button" onClick={ this.onLeaveMatchRoom }>Leave Match Room</div>
				<div className="Label">
					Connected to room from match: { this.matchRoom.current?.roomId }
				</div>
				{ this.renderVector( "Left", this.state.leftPosition ) }
				{ this.renderVector( "Right", this.state.rightPosition ) }
				{/* { this.renderVector( "Tmp Left", this.state.leftTmpPosition ) }
				{ this.renderVector( "Tmp Right", this.state.rightTmpPosition ) } */}
				{ this.state.error && <div className="Label">Error: {this.state.error }</div> }
			</>;
		}
		else
		{
			return <>
				<div className="Label">Click both triggers to join a test room by yourself</div>
				{/* { this.renderVector( "Tmp Left", this.state.leftTmpPosition ) }
				{ this.renderVector( "Tmp Right", this.state.rightTmpPosition ) } */}
				{ this.state.error && <div className="Label">Error: {this.state.error }</div> }
			</>;
		}
	}

	@bind
	private onLeftGrab( activeGrab: ActiveInterface )
	{
		this.setState( { leftGrab: activeGrab } );

		this.checkForClickStart();

		activeGrab.onEnded( () =>
		{
			this.setState( { leftGrab: null } );
		} );
	}

	@bind
	private onRightGrab( activeGrab: ActiveInterface )
	{
		this.setState( { rightGrab: activeGrab } );

		this.checkForClickStart();
		
		activeGrab.onEnded( () =>
		{
			this.setState( { rightGrab: null } );
		});
	}

	private checkForClickStart()
	{
		function convertPos( entityFromPeer: AvNodeTransform ): AvVector
		{
			let stageFromHand = nodeTransformToMat4( entityFromPeer ).inverse();
			let handPos = stageFromHand.multiplyVec4( new vec4( [ 0, 0, 0, 1 ] ) );
			return { x: handPos.x, y: handPos.y, z: handPos.z };
		}

		if( this.state.leftGrab && this.state.rightGrab )
		{
			this.setState( 
				{ 
					leftPosition: convertPos( this.state.leftGrab.selfFromPeer ),
					rightPosition: convertPos( this.state.rightGrab.selfFromPeer ),
				} );
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

				<AvOrigin path="/space/stage">
					<AvInterfaceEntity volume={ [ { type: EVolumeType.Sphere, radius: 0.001} ] } 
						receives={ [{iface: "room-grab@1" }]} />
				</AvOrigin>

				<AvOrigin path="/user/hand/left">
					{ this.state.leftPressed && <AvInterfaceEntity volume={ [ infiniteVolume() ] } 
						wantsTransforms={ true }
						transmits={ [ { iface: "room-grab@1", processor: this.onLeftGrab } ] }/>}
				</AvOrigin>
				<AvOrigin path="/user/hand/right">
					{ this.state.rightPressed && <AvInterfaceEntity volume={ [ infiniteVolume() ] } 
						wantsTransforms={ true }
						transmits={ [ { iface: "room-grab@1", processor: this.onRightGrab } ] }/>}
				</AvOrigin>

				{ this.state.leftPosition && this.state.rightPosition && <>
						<SimpleRoom ref={ this.matchRoom }
							leftPosition={ this.state.leftPosition } 
							rightPosition={ this.state.rightPosition }
							transform={ {} } 
							serverAddress={ this.props.serverAddress } 
							key="self_match"
							role={ SimpleRoomRole.Network }
							onUpdate={ () => this.forceUpdate() }/>
						<SimpleRoom 
							leftPosition={ this.state.rightPosition } 
							rightPosition={ this.state.leftPosition }
							transform={ { position: { x: 0, y: 1, z: 0 } } } 
							role={ SimpleRoomRole.Remote }
							serverAddress={ this.props.serverAddress } key="mirror_match"/>
					</> }
			</AvStandardGrabbable> );
	}

}

let main = Av() ? <SimpleRoomUI serverAddress="ws://localhost:18080" /> : <DefaultLanding/>
ReactDOM.render( main, document.getElementById( "root" ) );
