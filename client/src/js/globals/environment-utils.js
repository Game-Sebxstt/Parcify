import * as req from '../backend/requests';

const id_user = getCookie("ID-USER");
const primary_data = (await req.getPrimaryData(id_user)).data.message;
const data_user = {users: primary_data.user[0]};
let preferences = primary_data.favorites.length > 0 ? JSON.parse(primary_data.favorites[0].favorites) : false;
let templates = primary_data.templates.length > 0 ? primary_data.templates : false;
let projects = primary_data.projects.length > 0 ? primary_data.projects : false;

export function getDataUser() {
    return data_user;
}

export function getProfileImage(){
    return data_user.users.profile_image
}

export function getPreferences(){
    return preferences;
}

export function getPreference(id){
    if(!preferences){
        return false;
    }

    return preferences.find(preference => preference.id == id);
}

export function setPreferences(newPreferences) {
    preferences = newPreferences;
}

export function addPreferences(newPreferences) {
    if(!preferences){
        preferences = [newPreferences];
        return
    }

    preferences.push(newPreferences);
}

export function removePreferences(id) {
    if(!preferences){
        return false;
    }
    
    preferences = preferences.filter(preference => preference.id != id);
}

export function getTemplate(template_id){
    return templates.find(template => template.template_id == template_id);
}

export function setTemplate(template_id, template){
    const index = templates.findIndex(template => template.template_id == template_id);

    if(index == -1){
        templates.push(template);
    } else {
        templates[index] = template;
    }
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

export function getProjectsUser(user_id){
    if(!projects){
        return false;
    }

    return projects.filter(project => project.user_id == user_id);
}

export function getProjects(){
    if(!projects){
        return false;
    }

    return projects;
}

export function getProjectsShared(){
    if(!projects){
        return false;
    }

    return projects.filter(project => project.collaborators.includes(id_user) && project.user_id != id_user);
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