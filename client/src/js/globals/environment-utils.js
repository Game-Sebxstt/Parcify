import * as globals from '../frontend/utilities/globals';
import * as req from '../backend/requests';

const id_user = globals.getCookie("ID-USER");
const data_user = await req.getDataUser(id_user);

export function getDataUser() {
    return data_user.data.message;
}
