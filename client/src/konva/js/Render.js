import * as globals from '../../js/frontend/utilities/globals'

const utils = {
    list_collaborators: document.querySelectorAll("#list-collaborators"),
}

const references = {
    id_list: [],
}

export function updateCollaborators(collaborator){
    if(!collaborator) return;

    const id_find_list = references.id_list.find(id => id == collaborator.user_id);
    if(!id_find_list){
        references.id_list.push(collaborator.user_id);
    }

    utils.list_collaborators.forEach(list_collaborator => {
        list_collaborator.querySelectorAll("#profile-invite").forEach(collaboratorNode => {
            const attribute_id = collaboratorNode.getAttribute("data-id-user");
            let isFind = false;

            references.id_list.forEach(id => {
                if(attribute_id == id){
                    isFind = true;
                }
            })

            if(!isFind){
                collaboratorNode.style.display = "none";
            }else{
                collaboratorNode.style.display = "flex";
            }
        })
    })
}

export function removeCollaborator(collaborator){
    if(!collaborator) return;
    references.id_list = references.id_list.filter(id => id != collaborator.user_id);

    utils.list_collaborators.forEach(list_collaborator => {
        list_collaborator.querySelectorAll("#profile-invite").forEach(collaboratorNode => {
            const attribute_id = collaboratorNode.getAttribute("data-id-user");
            let isFind = false;

            references.id_list.forEach(id => {
                if(attribute_id == id){
                    isFind = true;
                }
            })

            if(!isFind){
                collaboratorNode.style.display = "none";
            }else{
                collaboratorNode.style.display = "flex";
            }
        })
    })
}