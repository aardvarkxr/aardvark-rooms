import { RoomServer } from './room_server';


let port = process.argv.length > 2 ? parseInt( process.argv[2] ) : 80;
let server = new RoomServer( port );
server.init();
