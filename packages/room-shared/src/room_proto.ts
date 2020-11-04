import { AvVector } from '@aardvarkxr/aardvark-shared';

export enum RoomMessageType
{
	Unknown 				= 0,

	JoinRoom 				= 100,
	JoinRoomResponse 		= 101,
	LeaveRoom 				= 102,
	LeaveRoomResponse 		= 103,
	JoinRoomWithMatch		= 104,
	JoinRoomWithMatchResponse = 105,

	CreateRoom 				= 201,
	CreateRoomResponse 		= 202,
	DestroyRoom 			= 203,
	DestroyRoomResponse 	= 204,	

	EjectedFromRoom 		= 301,
	RequestMemberInfo 		= 302,
	RequestMemberResponse 	= 303,
	AddRemoteMember			= 304,
	MemberLeft 				= 305,
	MessageFromPrimary		= 306,
	MessageFromSecondary	= 307,
}

export enum RoomResult
{
	Success 				= 0,

	UnknownFailure 			= -1,

	NoSuchRoom 				= -1001,
	PermissionDenied 		= -1002,
	InvalidParameters 		= -1003,
	AlreadyInThisRoom 		= -1004,
	UnknownMember 			= -1005,
	Disconnected			= -1006,
	MatchTimedOut			= -1007,
	ClickReplaced			= -1008,

}

export interface RoomMessage
{
	type: RoomMessageType;
	roomId?: string;
	memberId?: number;
	result?: RoomResult;
	initInfo?: object;
	message?: object;
	messageIsReliable?: boolean;

	// These fields are used for JoinRoomFromClick messages
	leftHandPosition?: AvVector;
	rightHandPosition?: AvVector;
}


// fred