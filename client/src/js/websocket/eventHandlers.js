import * as konva from '../../konva/js/KonvaLogic';
import * as GlobalFunctions from '../../konva/js/GlobalFunctions';
import * as Render from '../../konva/js/Render';
import * as chat from '../frontend/utilities/chat';
import * as utils from '../frontend/utilities/globals';

export function handleGroupElements(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const nodesList = data.elements.map(item => {
            const element = JSON.parse(item);
            return konva.stage.findOne(`#${element.attrs.id_unique}`);
        }).filter(Boolean);

        konva.groupElements(nodesList, data.generatedId, data.user_id);
    }
}

export function handleUngroupElements(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const groupKonva = JSON.parse(data.groupKonva[0]);
        konva.ungroupElements(groupKonva);
    }
}

export function handleCreateElementKonva(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.createElementKonva(elementKonva);
    }
}

export function handleDeleteElementKonva(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.deleteElementKonva(elementKonva);
    }
}

export function handleMoveElementKonva(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        if (data.type === 'moveUpElementKonva') {
            GlobalFunctions.moveUpElementKonva(elementKonva);
        } else if (data.type === 'moveDownElementKonva') {
            GlobalFunctions.moveDownElementKonva(elementKonva);
        }
    }
}

export function handleSelectElementKonva(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        const layerKonva = konva.stage.findOne('#layer');
        const elementKonvaOfLayer = GlobalFunctions.findElementByIdUnique(layerKonva, elementKonva.attrs.id_unique);
        if (elementKonvaOfLayer) {
            const collaborator = utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);
            GlobalFunctions.setBorderElement(elementKonvaOfLayer, collaborator);
        }
    }
}

export function handleDeselectElementKonva(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        GlobalFunctions.removeBorderElement();
    }
}

export function handleChangeElementKonva(data) {
    const node = JSON.parse(data.data.node);
    const layerKonva = konva.stage.findOne('#layer');
    const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, node.attrs.id_unique);
    if (elementKonvaOfLayer) {
        GlobalFunctions.setAttrOfAction(data.data.change, data.data.type, false, elementKonvaOfLayer);
    }
}

export function handleUpdatePosElementKonva(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        const dataNode = data.data;
        const layerKonva = konva.stage.findOne('#layer');
        const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, dataNode.id_unique);
        if (elementKonvaOfLayer) {
            GlobalFunctions.updateAttrsElement(elementKonvaOfLayer, dataNode);
            GlobalFunctions.updateCursorCollaborator(data.data.posCursor, data.data.id_user);
        }
    }
}

export function handleEnterCollaborator(data) {
    const collaboratorFind = utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);
    if (!collaboratorFind) {
        utils.saveCollaborators(data.collaborator.project_id, { user_id: data.user_id, state: true });
    }
    Render.updateCollaborators(data.collaborator);
    if (data.user_id !== utils.getCookie("ID-USER")) {
        GlobalFunctions.createCursorCollaborator(data.collaborator);
    }
}

export function handleMouseCursor(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        GlobalFunctions.updateCursorCollaborator(data.position, data.user_id);
    }
}

export function handleMessage(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        chat.createMessageExternal(data.data);
    }
}

export function handleTyping(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        chat.createTypingExternal(data.data);
    }
}

export function handleStopTyping(data) {
    if (data.user_id !== utils.getCookie("ID-USER")) {
        chat.removeTypingExternal(data.data);
    }
}