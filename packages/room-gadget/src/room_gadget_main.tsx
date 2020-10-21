import { AvPanel, AvStandardGrabbable, AvTransform, DefaultLanding, GrabbableStyle } from '@aardvarkxr/aardvark-react';
import { Av, g_builtinModelBox } from '@aardvarkxr/aardvark-shared';
import * as React from 'react';
import * as ReactDOM from 'react-dom';

interface SimpleRoomState
{
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

	public render()
	{
		return (
			<AvStandardGrabbable modelUri={ g_builtinModelBox } modelScale={ 0.03 } 
				modelColor="lightblue" style={ GrabbableStyle.Gadget } ref={ this.m_grabbableRef }>
				<AvTransform translateY={ 0.08 } >
					<AvPanel interactive={true} widthInMeters={ 0.1 }/>
				</AvTransform>
			</AvStandardGrabbable> );
	}

}

let main = Av() ? <SimpleRoom/> : <DefaultLanding/>
ReactDOM.render( main, document.getElementById( "root" ) );
