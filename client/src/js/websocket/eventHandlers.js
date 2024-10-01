import * as konva from '../../konva/js/KonvaLogic';
import * as GlobalFunctions from '../../konva/js/GlobalFunctions';
import * as Render from '../../konva/js/Render';
import * as chat from '../frontend/utilities/chat';
import * as utils from '../globals/environment-utils';
import * as globals from '../frontend/utilities/globals'
import * as req from '../backend/requests'

//Disabled
export function groupElements(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const nodesList = data.elements.map(item => {
            const element = JSON.parse(item);
            return konva.stage.findOne(`#${element.attrs.id_unique}`);
        }).filter(Boolean);

        konva.groupElements(nodesList, data.generatedId, data.user_id);
    }
}

//Disabled
export function ungroupElements(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const groupKonva = JSON.parse(data.groupKonva[0]);
        konva.ungroupElements(groupKonva);
    }
}

export function createElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.createElementKonva(elementKonva);
    }
}

export function deleteElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.deleteElementKonva(elementKonva);
    }
}

export function moveUpElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.moveUpElementKonva(elementKonva);
    }
}

export function moveDownElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.moveDownElementKonva(elementKonva);
    }
}

export function selectElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        const layerKonva = konva.stage.findOne('#layer');
        const elementKonvaOfLayer = GlobalFunctions.findElementByIdUnique(layerKonva, elementKonva.attrs.id_unique);
        if (elementKonvaOfLayer) {
            const collaborator = utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);
            GlobalFunctions.setBorderElement(elementKonvaOfLayer, collaborator);
        }
    }
}

export function deselectElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        GlobalFunctions.removeBorderElement();
    }
}

export function changeElementKonva(data) {
    const node = JSON.parse(data.data.data.node);
    const layerKonva = konva.stage.findOne('#layer');
    const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, node.attrs.id_unique);
    if (elementKonvaOfLayer) {
        GlobalFunctions.setAttrOfAction(data.data.data.change, data.data.data.type, false, elementKonvaOfLayer);
    }
}

export function updatePosElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const dataNode = data.data;
        const layerKonva = konva.stage.findOne('#layer');
        const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, dataNode.data.id_unique);
        if (elementKonvaOfLayer) {
            GlobalFunctions.updateAttrsElement(elementKonvaOfLayer, dataNode);
            GlobalFunctions.updateCursorCollaborator(data.data.data.posCursor, data.data.id_user);
        }
    }
}

export function enterCollaborator(data) {
    const collaboratorFind = utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);
    if (!collaboratorFind) {
        req.saveCollaborators(data.collaborator.project_id, { user_id: data.user_id, state: true });
    }
    Render.updateCollaborators(data.collaborator);
    if (data.user_id !== globals.getCookie("ID-USER")) {
        GlobalFunctions.createCursorCollaborator(data.collaborator);
    }
}

export async function exitCollaborator(data) {
    if(!data.data || !data.data.collaborator || !data.data.collaborator.project_id) {
        console.error('Collaborator data is missing:', data);
        return;
    }

    const data_change = {
        user_id: data.data.id,
        state: false,
    }

    const collaboratorFind = utils.getCollaboratorOfProject(data.data.collaborator.project_id, data.user_id);

    if(!collaboratorFind){
        await req.saveCollaborators(data.data.collaborator.project_id, data_change)
    }
    
    const project_database = utils.getProject(data.data.collaborator.project_id)
    const project_collaborators = JSON.parse((await req.getProject(data.data.collaborator.project_id)).data.message.collaborators);
    project_collaborators.forEach(item => {
        if(item.state) return;

        Render.removeCollaborator(item)
    })

    GlobalFunctions.removeCursorCollaborator(data.data.id);
}

export function mouseCursor(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        GlobalFunctions.updateCursorCollaborator(data.position, data.user_id);
    }
}

export function message(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        chat.createMessageExternal(data.data);
    }
}

export function typing(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        chat.createTypingExternal(data.data.data);
    }
}

export function stopTyping(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        chat.removeTypingExternal(data.data.data);
    }
}