
export enum RoomMessageType
{
	Unknown = 0,

	JoinRoom = 100,
	JoinRoomResponse = 101,
	LeaveRoom = 102,
	LeaveRoomResponse = 103,
}

export enum RoomResult
{
	Success = 0,

	NoSuchRoom = 1001,
}

export interface RoomMessage
{
	type: RoomMessageType;
	roomId?: string;
	result?: RoomResult;
}


// fred