
export enum RoomMessageType
{
	Unknown = 0,

	JoinRoom = 100,
	LeaveRoom = 101,
}

export interface RoomMessage
{
	type: RoomMessageType;
}


// fred