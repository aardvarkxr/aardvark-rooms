
export enum RoomMessageType
{
	Unknown = 0,

	JoinRoom = 100,
	JoinRoomResponse = 101,
	LeaveRoom = 102,
	LeaveRoomResponse = 103,

	CreateRoom = 201,
	CreateRoomResponse = 202,
	DestroyRoom = 203,
	DestroyRoomResponse = 204,	
}

export enum RoomResult
{
	Success = 0,

	NoSuchRoom = 1001,
	PermissionDenied = 1002,
}

export interface RoomMessage
{
	type: RoomMessageType;
	roomId?: string;
	result?: RoomResult;
}


// fred