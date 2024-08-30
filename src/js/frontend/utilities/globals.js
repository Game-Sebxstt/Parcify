import * as req from "../../backend/requests";

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

export function startSession(project_id) {
    const startTime = new Date();
    localStorage.setItem('sessionStartTime', JSON.stringify({startTime: startTime, project_id: project_id}));
}

export function endSession() {
    const sessionStartTime = JSON.parse(localStorage.getItem('sessionStartTime'));
    const startTime = new Date(sessionStartTime.startTime);
    const endTime = new Date();
    const sessionTimeWorked = Math.round((endTime - startTime) / 1000 / 60) < 1 ? 0 : Math.round((endTime - startTime) / 1000 / 60);

    const user_id = getCookie("ID-USER");
    const projectId = sessionStartTime.project_id;

    req.getCollaborators(projectId).then((data) => {
        if (!data.state) {
            utils.handleError(data);
            return;
        }

        const existingCollaborator = data.collaborators.find(c => c.user_id === Number(user_id));
        const currentDate = new Date();
        const timeWorkedPerDay = existingCollaborator ? existingCollaborator.time_worked || [] : [];
        const existingEntry = timeWorkedPerDay.find(entry => entry.date === currentDate);

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
            } else {
                window.location.href = "/";
            }
        });
    });
}
