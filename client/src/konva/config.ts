import type Konva from "konva"
import type { Node, NodeConfig } from "konva/lib/Node"

export const list_id_ignore = ["transformer", "boxShape", "anchorPoint"]

let list_box_groups: Node<NodeConfig>[] = []
let list_groups: Node<NodeConfig>[] = []
let node_selected: Node;

export function setNodeSelected(node: Node){
    node_selected = node
}

export function setBoxGroup(group: Konva.Node){
    list_box_groups.push(group)
}

export function setGroup(group: Konva.Node){
    list_groups.push(group)
}

export function setGroups(groups: Konva.Node[]){
    list_groups = groups
}

export function getNodeSelected(): Konva.Node{
    return node_selected
}

export function getBoxGroups(){
    return list_box_groups
}

export function getGroups(){
    return list_groups
}

export function getGroup(id: string): Konva.Node{
    return list_groups.find(group => group.id() === id) as Konva.Node
}

export function getBoxGroupOfGroup(group: Konva.Group): Konva.Node{
    return list_box_groups.find(box_group => box_group.id() === group.id()) as Konva.Node
}