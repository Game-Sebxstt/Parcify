import Konva from 'konva';

interface ConnectorOptions {
    enabledAnchors?: string[];
    anchorSize?: number;
    borderColor?: string;
    anchorColor?: string;
    arrowColor?: string;
}

interface ClosestAnchorResult {
    targetAnchor: Konva.Circle | null;
    targetClosest: Konva.Node | null;
}

export class TransformerPoints {
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private elements: Konva.Node[];
    private targetNode: Konva.Node | null = null;
    private options: ConnectorOptions;
    private isDragging: boolean = false;
    private anchors: Konva.Circle[] = [];
    private transforms: TransformerPoints[] = [];
    private separationOffset = 20;
    private initialAnchorPosition: { x: number, y: number } = { x: 0, y: 0 };
    private activeAnchorType: string | null = null;
    private arrowMap: { [key: string]: Konva.Arrow } = {};
    private scale: number = 1;

    constructor(stage: Konva.Stage, layer: Konva.Layer, elements: Konva.Node[], options?: ConnectorOptions) {
        this.stage = stage;
        this.layer = layer;
        this.elements = elements;
        this.options = options || {
            enabledAnchors: ['left', 'right', 'bottom', 'top'],
            anchorSize: 7,
            borderColor: '#80D0FF',
            anchorColor: 'white',
            arrowColor: 'red',
        };

        this.addGlobalEvents();
        this.addStageZoomListener();
        this.updateScale();
    }

    private addGlobalEvents() {
        this.stage.on('click', (e) => {
            if (!this.targetNode || !e.target || e.target === this.targetNode) return;
            this.detach();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.detach();
            }
        });
    }

    private addStageZoomListener() {
        this.stage.on('transform', () => this.handleZoomOrTransform());
        this.stage.on('wheel', () => this.handleZoomOrTransform());
    }

    private handleZoomOrTransform() {
        this.updateScale();
        this.updateAnchors();
        this.updateArrows();
        this.layer.batchDraw();
    }

    private updateScale() {
        this.scale = this.stage.scaleX() > 0.5 ? this.stage.scaleX() : 0.5;
        this.scale = this.scale < 5 ? this.scale : 5;
    }

    private getAnchorPositions(elementNode: Konva.Node | null){
        if (!elementNode || !this.targetNode) return {};

        const anchorPositions: { [key: string]: { x: number, y: number } } = {
            'left': { x: -this.separationOffset, y: this.targetNode.height() * elementNode?.scaleY() / 2 },
            'right': { x: this.targetNode.width() * elementNode?.scaleX() + this.separationOffset, y: this.targetNode.height() * elementNode?.scaleY() / 2 },
            'bottom': { x: this.targetNode.width() * elementNode?.scaleX() / 2, y: this.targetNode.height() * elementNode?.scaleY() + this.separationOffset },
            'top': { x: this.targetNode.width() * elementNode?.scaleX() / 2, y: -this.separationOffset }
        };

        return anchorPositions;
    }

    public attachTo(node: Konva.Node) {
        if (!node || node.attrs.id === "anchorPoint") return;

        this.targetNode = node;
        this.addNodeEvents();

        this.anchors.forEach(anchor => anchor.destroy());
        this.anchors = [];

        const anchorPositions = this.getAnchorPositions(this.targetNode);

        this.options.enabledAnchors?.forEach((anchorType) => {
            const pos = anchorPositions[anchorType];
            if (pos) {
                const anchor = new Konva.Circle({
                    x: (this.targetNode?.x() || 0) + pos.x,
                    y:( this.targetNode?.y() || 0) + pos.y,
                    radius: (this.options.anchorSize || 7) / this.scale,
                    fill: this.options.anchorColor || 'white',
                    stroke: this.options.borderColor || '#80D0FF',
                    strokeWidth: 2 / this.scale,
                    name: anchorType,
                    id: "anchorPoint",
                    draggable: true,
                });

                anchor.on('dragstart', (e) => this.onAnchorDragStart(e, anchor));
                anchor.on('dragmove', (e) => this.onAnchorDrag(e, anchor));
                anchor.on('dragend', (e) => this.onAnchorDragEnd(e, anchor));

                this.anchors.push(anchor);
                this.layer.add(anchor);
            }
        });

        this.targetNode?.setAttrs({ transformer: this });

        this.layer.batchDraw();
    }

    public detach() {
        this.anchors.forEach(anchor => anchor.destroy());
        this.anchors = [];
        this.targetNode = null;

        this.layer.batchDraw();
    }

    private addNodeEvents() {
        if (!this.targetNode) return;

        this.targetNode.on('transform', () => {
            this.updateAnchors();
            this.updateArrows();
            this.layer.batchDraw();
        });

        this.targetNode.on("dragmove", (e) => {
            
            if (!this.targetNode) {
                this.targetNode = e.target;
                this.attachTo(this.targetNode);
            }

            this.updateAnchors(this.targetNode.attrs.transformer);
            this.updateArrows();
            this.layer.batchDraw();
        });
    }

    private onAnchorDragStart(e: Konva.KonvaEventObject<DragEvent>, anchor: Konva.Circle) {
        if (!this.targetNode) return;

        this.isDragging = true;
        this.activeAnchorType = anchor.name();

        const startX = anchor.x();
        const startY = anchor.y();
        this.initialAnchorPosition = { x: startX, y: startY };

        const mousePos = this.stage.getRelativePointerPosition();
        if (!mousePos) return;

        if (this.arrowMap[this.activeAnchorType || '']) {
            this.arrowMap[this.activeAnchorType || ''].destroy();
        }

        const arrow = new Konva.Arrow({
            points: [startX, startY, mousePos.x, mousePos.y],
            stroke: this.options.arrowColor || 'red',
            fill: this.options.arrowColor || 'red',
            strokeWidth: 2 / this.scale,
            pointerLength: 10 / this.scale,
            pointerWidth: 10 / this.scale,
            lineCap: 'round',
            lineJoin: 'round',
        });

        this.arrowMap[this.activeAnchorType || ''] = arrow;
        this.elements.forEach((element: Konva.Node) => {
            if (element === this.targetNode) return;

            if (!element.attrs.transformerTarget && !element.attrs.transformersUnit) {
                console.log("dlwjkadlaj")
                const transformer = new TransformerPoints(this.stage, this.layer, this.elements, this.options);
                element.setAttrs({ transformerTarget: transformer });
                element.setAttrs({ transformersUnit: [null] });
            }

            console.log("element.attrs",element.attrs)

            const transformer = element.attrs.transformerTarget as TransformerPoints;
            transformer.attachTo(element);
            this.transforms.push(transformer);
            element.attrs.transformersUnit = [...element.attrs.transformersUnit, this.targetNode?.attrs.transformer];
        });

        this.layer.add(arrow);
        this.layer.batchDraw();
    }

    private onAnchorDrag(e: Konva.KonvaEventObject<DragEvent>, anchor: Konva.Circle) {
        if (!this.isDragging || !this.activeAnchorType) return;

        const mousePos = this.stage.getRelativePointerPosition();
        if (!mousePos) return;

        const arrow = this.arrowMap[this.activeAnchorType || ''];
        if (arrow) {
            arrow.points([this.initialAnchorPosition.x, this.initialAnchorPosition.y, mousePos.x, mousePos.y]);
        }

        this.layer.batchDraw();
        this.updateAnchors();
        this.updateArrows();
    }

    private onAnchorDragEnd(e: Konva.KonvaEventObject<DragEvent>, anchor: Konva.Circle) {
        this.isDragging = false;

        const mousePos = this.stage.getRelativePointerPosition();
        if (!mousePos || !this.activeAnchorType) return;

        const {targetAnchor, targetClosest} = this.findClosestAnchor(mousePos);

        targetClosest?.on('dragmove', (e) => {
            this.updateAnchors();
            this.updateArrows();
            this.layer.batchDraw();
        });

        if (targetAnchor) {
            const arrow = this.arrowMap[this.activeAnchorType || ''];
            if (arrow) {
                arrow.points([this.initialAnchorPosition.x, this.initialAnchorPosition.y, targetAnchor.x(), targetAnchor.y()]);
            }
        } else {
            this.arrowMap[this.activeAnchorType || '']?.destroy();
            delete this.arrowMap[this.activeAnchorType || ''];
        }

        this.activeAnchorType = null;
        this.layer.batchDraw();
    }

    private findClosestAnchor(mousePos: { x: number, y: number }): ClosestAnchorResult {
        const proximityThreshold = 10;
        let targetAnchor: Konva.Circle | null = null;
        let minDistance = Infinity;
        let targetClosest: Konva.Node | null = null;

        this.transforms.forEach(transformer => {
            transformer.anchors.forEach(anchor => {
                const dist = Math.sqrt(Math.pow(anchor.x() - mousePos.x, 2) + Math.pow(anchor.y() - mousePos.y, 2));
                if (dist < proximityThreshold && dist < minDistance) {
                    targetAnchor = anchor;
                    minDistance = dist;
                    targetClosest = transformer.targetNode;
                }
            });
        });

        return {targetAnchor, targetClosest};
    }

    private updateAnchors(transformer?: TransformerPoints) {
        if (!this.targetNode) return;

        const anchorPositionsTarget = this.getAnchorPositions(this.targetNode);

        if (transformer) {
            const anchorPositions = this.getAnchorPositions(transformer.targetNode);
            transformer.anchors.forEach(anchor => {
                const anchorType = anchor.name();
                const pos = anchorPositions[anchorType];
                if (pos) {
                    const newX = (transformer.targetNode?.x() || 0) + pos.x;
                    const newY = (transformer.targetNode?.y() || 0) + pos.y;

                    anchor.position({ x: newX, y: newY });
                    anchor.radius((this.options.anchorSize || 7) / this.scale);
                    anchor.strokeWidth(2 / this.scale);

                    const arrow = this.targetNode?.attrs.transformer.arrowMap[anchorType];
                    console.log("arrow", this.targetNode?.attrs)
                    if (arrow) {
                        const {targetAnchor, targetClosest} = this.findClosestAnchor({ x: arrow.points()[2], y: arrow.points()[3] });
                        console.log("targetAnchor",targetAnchor)
                        console.log("targetClosest",targetClosest)
                        if (targetAnchor) {
                            arrow.points([newX, newY, targetAnchor.x(), targetAnchor.y()]);
                        } else {
                            arrow.points([newX, newY, arrow.points()[2], arrow.points()[3]]);
                        }
                    }
                }
            });
        }

        this.transforms.forEach(transformer => {
            const anchorPositions = this.getAnchorPositions(transformer.targetNode);
            transformer.anchors.forEach(anchor => {
                const anchorType = anchor.name();
                const pos = anchorPositions[anchorType];
                if (pos) {
                    const newX = (transformer.targetNode?.x() || 0) + pos.x;
                    const newY = (transformer.targetNode?.y() || 0) + pos.y;

                    anchor.position({ x: newX, y: newY });
                    anchor.radius((this.options.anchorSize || 7) / this.scale);
                    anchor.strokeWidth(2 / this.scale);

                    const arrow = transformer.arrowMap[anchorType];
                    if (arrow) {
                        const {targetAnchor, targetClosest} = this.findClosestAnchor({ x: arrow.points()[2], y: arrow.points()[3] });
                        console.log(targetClosest)
                        if (targetAnchor) {
                            arrow.points([newX, newY, targetAnchor.x(), targetAnchor.y()]);
                        } else {
                            arrow.points([newX, newY, arrow.points()[2], arrow.points()[3]]);
                        }
                    }
                }
            });
        });

        this.anchors.forEach(anchor => {
            const anchorType = anchor.name();
            const pos = anchorPositionsTarget[anchorType];
            if (pos) {
                const newX = (this.targetNode?.x() || 0) + (pos.x);
                const newY = (this.targetNode?.y() || 0) + (pos.y);

                anchor.position({ x: newX, y: newY });
                anchor.radius((this.options.anchorSize || 7) / this.scale);
                anchor.strokeWidth(2 / this.scale);

                const arrow = this.arrowMap[anchorType];
                if (arrow) {
                    const {targetAnchor, targetClosest} = this.findClosestAnchor({ x: arrow.points()[2], y: arrow.points()[3] });
                    if (targetAnchor) {
                        arrow.points([newX, newY, targetAnchor.x(), targetAnchor.y()]);
                    } else {
                        arrow.points([newX, newY, arrow.points()[2], arrow.points()[3]]);
                    }
                }
            }
        });

        this.layer.batchDraw();
    }

    private updateArrows() {
        for (const [anchorType, arrow] of Object.entries(this.arrowMap)) {
            if (arrow) {
                const startX = arrow.points()[0];
                const startY = arrow.points()[1];
                const endX = arrow.points()[2];
                const endY = arrow.points()[3];

                arrow.strokeWidth(2 / this.scale);
                arrow.pointerLength(10 / this.scale);
                arrow.pointerWidth(10 / this.scale);

                arrow.points([startX, startY, endX, endY]);
            }
        }

        this.layer.batchDraw();
    }
}
