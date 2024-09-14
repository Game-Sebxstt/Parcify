import * as req from "../../js/backend/requests";
import * as globals from '../../js/frontend/utilities/globals';
import * as front from '../../js/frontend/front';
import * as environment_utils from '../../js/globals/environment-utils'

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

        const collaborators = JSON.parse(data_project.collaborators);
        console.log(collaborators);
    
        if(data_project.invitation !== invitation){
            front.utils.handleError("Invalid invitation");
            return
        }

        if(collaborators.find(c => c.user_id == globals.getCookie("ID-USER"))){
            front.utils.handleError("You are already a collaborator");
            return
        }

        await sendCollaboration(id);
    }
}

async function sendCollaboration(id){
    const updatedCollaborators = {
        user_id: Number(globals.getCookie("ID-USER")),
        name: environment_utils.getDataUser().users.username,
        role: "normal",
        commits: [],
        last_commit: "",
        last_access: "",
        time_worked: [],
        pages_created: 0,
        elements_used: 0,
        plugins_used: 0
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