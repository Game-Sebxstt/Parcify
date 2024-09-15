import * as globals from '../frontend/utilities/globals';
import * as req from '../backend/requests';

const id_user = globals.getCookie("ID-USER");
const data_user = await req.getDataUser(id_user);
let collaborators = [];

export function getDataUser() {
    return data_user.data.message;
}

export function getCollaborators() {
    return collaborators;
}

export function setCollaborators(collaborators) {
    collaborators = collaborators;
}