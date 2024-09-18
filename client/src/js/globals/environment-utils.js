import * as req from '../backend/requests';

const id_user = getCookie("ID-USER");
const data_user = await req.getDataUser(id_user);
let preferences = (await req.getFavorites(id_user));
preferences = preferences.state ? JSON.parse(preferences.data.message.favorites) : preferences.state;

let templates = (await req.getAllTemplates()).data.message;

let projects = (await req.getAllProjectsGlobal())
projects = projects.state ? projects.data.projects : projects.state;

export function getDataUser() {
    return data_user.data.message;
}

export function getProfileImage(){
    return data_user.data.message.users.profile_image
}

export function getPreferences(){
    return preferences;
}

export function addPreferences(newPreferences) {
    if(!preferences){
        preferences = [newPreferences];
        return
    }

    preferences.push(newPreferences);
}

export function removePreferences(id) {
    preferences = preferences.filter(preference => preference.id !== id);
}

export function getTemplate(template_id){
    return templates.find(template => template.template_id == template_id);
}

export function getTemplates(){
    return templates;
}

export function getProject(project_id) {
    if(!projects){
        return false;
    }

    return projects.find(project => project.project_id == project_id);
}

export function getProjects(){
    if(!projects){
        return false;
    }

    return projects;
}

export function getStageOfProject(project_id){
    const project = getProject(project_id);

    if(!project){
        return false;
    }

    return JSON.parse(project.stage);
}

export function getCollaboratorOfProject(project_id, user_id){
    const project = getProject(project_id);

    if(!project){
        return false;
    }

    return JSON.parse(project.collaborators).find(collaborator => collaborator.user_id == user_id);
}

export function setCollaboratorOfProject(project_id, user_id, collaborator, database = false){
    const project = getProject(project_id);

    if(!project){
        return false;
    }

    const collaborators = JSON.parse(project.collaborators);
    const index = collaborators.findIndex(collaborator => collaborator.user_id == user_id);

    if(index == -1){
        collaborators.push(collaborator);
    } else {
        collaborators[index] = collaborator;
    }

    project.collaborators = JSON.stringify(collaborators);

    if(database){
        req.saveCollaborators(project_id, collaborator);
    }
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) == " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}