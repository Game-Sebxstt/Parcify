import * as req from "../../js/backend/requests";
import * as globals from '../../js/frontend/utilities/globals';
import * as GlobalFunctions from './GlobalFunctions'
import * as front from '../../js/frontend/front';
import * as environment_utils from '../../js/globals/environment-utils'
import * as environments from '../../environments'
import * as websocket from '../../js/backend/websocket'

async function initialCollaboration(){
    const urlParams = new URLSearchParams(window.location.search);
    const invitation = urlParams.get('invitation');
    const id = urlParams.get('id');

    let data_project;
    
    if(id){
        const project = await req.getProject(id);
    
        if (!project.state) {
            front.utils.handleError(project);
            return;
        }
    
        data_project = project.data.message;

        const collaborators = JSON.parse(data_project.collaborators || "[]");
        const data_invitation_project = JSON.parse(data_project.invitation || "[]");
        eventsListener(collaborators);

        const collaboratorOwner = collaborators.find(c => c.role === 'owner');

        if(collaboratorOwner.user_id == globals.getCookie("ID-USER")){
            front.utils.handleError("You are the owner of the project");
            websocket.enterCollaborator(collaboratorOwner);
            return
        }
    
        if(data_invitation_project.invitation !== invitation){
            front.utils.handleError("Invalid invitation");
            return
        }

        if(collaborators.find(c => c.user_id == globals.getCookie("ID-USER"))){
            front.utils.handleError("You are already a collaborator");
            const collaborator = collaborators.find(c => c.user_id == globals.getCookie("ID-USER"));
            websocket.enterCollaborator(collaborator);
            return
        }

        let isFindColor = false;
        environments.colors.forEach(color => {
            if (isFindColor) return;

            if(!collaborators.find(c => c.color == color)){
                websocket.enterCollaborator(collaborators.find(c => c.user_id == globals.getCookie("ID-USER")));
                sendCollaboration(id, data_invitation_project, color);
                isFindColor = true;
                return;
            }
        })
    }
}

function eventsListener(collaborators){
    GlobalFunctions.detectedMouseMove();

    collaborators.forEach(collaborator => {
        if(collaborator.user_id == globals.getCookie("ID-USER")) return;
        GlobalFunctions.createCursorCollaborator(collaborator.color.hex, collaborator.user_id);
    })
}

async function sendCollaboration(id, data_invitation_project, color){
    const updatedCollaborators = {
        user_id: Number(globals.getCookie("ID-USER")),
        name: environment_utils.getDataUser().users.username,
        role: data_invitation_project.role,
        commits: [],
        last_commit: "",
        last_access: "",
        time_worked: [],
        pages_created: 0,
        elements_used: 0,
        plugins_used: 0,
        color: color,
    }

    req.saveCollaborators(id, updatedCollaborators).then((response) => {
        if (!response.state) {
            front.utils.handleError(response);
        } else {
            front.utils.handleError("Collaboration started");
        }
    });
}

await initialCollaboration();