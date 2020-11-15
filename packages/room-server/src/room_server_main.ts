import { RoomServer } from './room_server';


let port = process.argv.length > 2 ? parseInt( process.argv[2] ) : parseInt( process.env.PORT ?? "18080" );
let server = new RoomServer( port );
server.init();
