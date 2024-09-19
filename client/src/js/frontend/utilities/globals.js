import * as req from "../../backend/requests";
import * as environments from '../../../../../config'
import * as environment_utils from '../../globals/environment-utils.js'

let templates;

export function formatNumber(num) {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(1) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(1) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(1) + 'k';
    } else {
        return num;
    }
}

export function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) == " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

export function setCookie(name, value, days) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

export async function startSession(project_id) {
    console.log("Session started")
    const startTime = new Date();
    localStorage.setItem('sessionStartTime', JSON.stringify({startTime: startTime, project_id: project_id}));
    await req.saveCollaborators(project_id, {
        user_id: getCookie("ID-USER"),
        state: true,
    })
}

export async function endSession(redirect = true) {
    const sessionStartTime = JSON.parse(localStorage.getItem('sessionStartTime'));
    const startTime = new Date(sessionStartTime.startTime);
    const endTime = new Date();
    const sessionTimeWorked = Math.round((endTime - startTime) / 1000 / 60) < 1 ? 0 : Math.round((endTime - startTime) / 1000 / 60);

    const user_id = getCookie("ID-USER");
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');

    await req.saveCollaborators(projectId, {
        user_id: user_id,
        state: false,
    });

    req.getCollaborators(projectId).then((data) => {
        if (!data.state) {
            return;
        }

        const existingCollaborator = data.collaborators.find(c => c.user_id === Number(user_id));
        const currentDate = new Date();
        const timeWorkedPerDay = existingCollaborator ? existingCollaborator.time_worked || [] : [];
        const existingEntry = timeWorkedPerDay.find(entry => entry.date.split("T")[0] === currentDate.toISOString().split("T")[0]);

        if (existingEntry) {
            existingEntry.time += sessionTimeWorked;
        } else {
            timeWorkedPerDay.push({
                date: currentDate,
                time: sessionTimeWorked,
            });
        }

        const updatedCollaborator = {
            user_id: user_id,
            time_worked: timeWorkedPerDay,
            last_access: new Date(),
        };

        req.saveCollaborators(projectId, updatedCollaborator).then((response) => {
            if (!response.state) {
                utils.handleError(response);
            }else{
                if(redirect){
                    window.location.href = "/";
                }
            }
        });
    });
}

export function sortByKey(arr, key, order = 'asc') {
    return arr.sort((a, b) => {
        const dateA = Date.parse(a[key]);
        const dateB = Date.parse(b[key]);

        if (order === 'asc') {
            return dateA - dateB;
        } else if (order === 'desc') {
            return dateB - dateA;
        }

        return 0;
    });
}

export function formatLocalTimeString(time){
    const timeParts = time.split(':');
    let hours = parseInt(timeParts[0], 10);
    const minutes = timeParts[1];
    const period = hours >= 12 ? 'P.M' : 'A.M';

    hours = hours % 12 || 12;

    return `${hours}:${minutes} ${period}`;
}

export function lastModified(fechas) {
    const fechasObjeto = fechas.map((fecha) => new Date(fecha));
    const ultimaModificacion = new Date(Math.max(...fechasObjeto));
    const ahora = new Date();

    const diferencia = ahora - ultimaModificacion;

    const segundos = Math.floor(diferencia / 1000);
    const minutos = Math.floor(segundos / 60);
    const horas = Math.floor(minutos / 60);
    const dias = Math.floor(horas / 24);
    const meses = Math.floor(dias / 30);
    const años = Math.floor(meses / 12);

    if (años > 0) {
        return `${años} año${años !== 1 ? 's' : ''}`;
    } else if (meses > 0) {
        return `${meses} mes${meses !== 1 ? 'es' : ''}`;
    } else if (dias > 0) {
        return `${dias} día${dias !== 1 ? 's' : ''}`;
    } else if (horas > 0) {
        return `${horas} hora${horas !== 1 ? 's' : ''}`;
    } else if (minutos > 0) {
        return `${minutos} minuto${minutos !== 1 ? 's' : ''}`;
    } else {
        return `${segundos} segundo${segundos !== 1 ? 's' : ''}`;
    }
}

export async function isFavorite(project_id) {
    let dataPreferences = environment_utils.getPreferences();
    let dataFilter = [];

    if (dataPreferences){
        const projectUser = environment_utils.getProjects().filter(project => project.user_id == getCookie("ID-USER"));
        console.log(projectUser)
        console.log(dataPreferences)
        
        dataPreferences.forEach((item) => {
            projectUser.forEach((elementUser) => {
                if (elementUser.project_id == item.id) {
                    elementUser["type"] = item.type;
                    dataFilter.push(elementUser);
                }
            });
        });
    }
  
    return dataFilter.some((favorite) => favorite.project_id == project_id);
}

export function isNewProject(last_modified){
    const threeHoursAgo = new Date().getTime() - (2 * 60 * 60 * 1000); 
    const lastModifiedTime = new Date(last_modified).getTime(); 
    return lastModifiedTime >= threeHoursAgo;
}

export function generateID(){
    return Math.random().toString(36).substr(2, 9);
}

export function generateString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return result;
}

export function generateLinkInvitation(id_project){
    const invitation = generateString(30);
    const url = `${window.location.protocol}//${window.location.host}/konva/?id=${id_project}&invitation=${invitation}`;

    return { url, invitation };
}

export function hexToRGBA(hex, alpha){
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function formatTimeMinute(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}