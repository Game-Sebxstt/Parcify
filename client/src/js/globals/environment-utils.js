import * as req from '../backend/requests';

const id_user = getCookie("ID-USER");
const data_user = await req.getDataUser(id_user);
let preferences = (await req.getFavorites(id_user));
preferences = preferences.state ? JSON.parse(preferences.data.message.favorites) : preferences.state;

let templates = (await req.getAllTemplates()).data.message;

let projects = (await req.getAllProjects(id_user))
projects = projects.state ? projects.data.message : projects.state;

console.log(templates)
console.log(projects)
console.log(preferences)

export function getDataUser() {
    return data_user.data.message;
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
    return projects.find(project => project.project_id == project_id);
}

export function getProjects(){
    return projects;
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