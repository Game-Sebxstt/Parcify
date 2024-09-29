import * as req from "../../js/backend/requests";
import * as globals from '../../js/frontend/utilities/globals';
import * as templates from '../../js/frontend/utilities/templates';
import * as GlobalFunctions from './GlobalFunctions'
import * as Render from './Render'
import * as front from '../../js/frontend/front';
import * as environments from '../../environments'
import * as environment_utils from '../../js/globals/environment-utils'
import * as websocket from '../../js/websocket/actions'

function initialCollaboration(){
    const urlParams = new URLSearchParams(window.location.search);
    const invitation = urlParams.get('invitation');
    const id = urlParams.get('id');

    
    if(id){
        const project = environment_utils.getProject(id);
    
        if (!project) {
            front.utils.handleError("Couldn't find project");
            return;
        }
    
        globals.startSession(id);
        const collaborators = JSON.parse(project.collaborators || "[]");
        const data_invitation_project = JSON.parse(project.invitation || "[]");
        eventsListener(collaborators);
        resetCollaborators(collaborators);

        Render.utils.list_collaborators = document.querySelectorAll("#list-collaborators");

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
            console.log("Ya eres colaborador");
            websocket.enterCollaborator(collaborator);
            return
        }

        let isFindColor = false;
        environments.colors.forEach(color => {
            if (isFindColor) return;

            if(!collaborators.find(c => c.color == color)){
                sendCollaboration(id, data_invitation_project, color, collaborators);
                isFindColor = true;
                return;
            }
        })
    }
}

function eventsListener(collaborators){
    GlobalFunctions.detectedMouseMove();

    collaborators.forEach(collaborator => {
        if(collaborator.user_id == globals.getCookie("ID-USER") && collaborator.state) return;
        console.log("collaborator", collaborator);
        GlobalFunctions.createCursorCollaborator(collaborator);
    })
}

async function sendCollaboration(id, data_invitation_project, color, collaborators){
    const updatedCollaborators = {
        user_id: Number(globals.getCookie("ID-USER")),
        project_id: id,
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
        state: true,
    }

    req.saveCollaborators(id, updatedCollaborators).then((response) => {
        if (!response.state) {
            front.utils.handleError(response);
        } else {
            front.utils.handleError("Collaboration started");
            collaborators.push(updatedCollaborators);
            resetCollaborators(collaborators);
            websocket.enterCollaborator(updatedCollaborators);
        }
    });
}

function resetCollaborators(collaborators){
    Render.utils.list_collaborators.forEach(collaborators => {
        collaborators.querySelectorAll("#profile-invite").forEach(collaborator => {
            collaborator.remove();
        })
    })

    collaborators.forEach(collaborator => {
        Render.utils.list_collaborators.forEach(collaborators => {
            const profile_invite = templates.createProfileInvite(collaborator);

            if(collaborator.state){
                profile_invite.style.display = "flex";
            }
            
            collaborators.appendChild(profile_invite);
        });
    })
}

window.addEventListener('beforeunload', function(e) {
    // e.preventDefault();
    globals.endSession(false);
});

initialCollaboration();