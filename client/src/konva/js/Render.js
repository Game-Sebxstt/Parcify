import * as globals from '../../js/frontend/utilities/globals'

const utils = {
    list_collaborators: document.querySelectorAll("#list-collaborators"),
}

export function updateCollaborators(collaborator){
    let id_list = [globals.getCookie("ID-USER"), collaborator.user_id];

    utils.list_collaborators.forEach(list_collaborator => {
        list_collaborator.querySelectorAll("#profile-invite").forEach(collaboratorNode => {
            const attribute_id = collaboratorNode.getAttribute("data-id-user");
            let isFind = false;

            id_list.forEach(id => {
                if(attribute_id == id){
                    isFind = true;
                }
            })

            if(!isFind){
                collaboratorNode.remove();
            }
        })
    })
}