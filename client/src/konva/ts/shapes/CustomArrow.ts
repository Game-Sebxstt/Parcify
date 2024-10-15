import Konva from 'konva';
import * as konva from '../../js/KonvaLogic.js'

interface ConfigArrow extends Konva.ArrowConfig {
    circleColor?: string;
    circleRadius?: number;
    separationOffset?: number;
}

export class CustomArrow extends Konva.Arrow {
    private anchorCircles: Konva.Circle[];
    private customScale: number = 1;
    private separationOffset: number;
    private stage: Konva.Stage;
    private layer: Konva.Layer;

    constructor(config: ConfigArrow) {
        super(config);

        this.stage = konva.stage as Konva.Stage;
        this.layer = konva.layer as Konva.Layer;
        this.separationOffset = config.separationOffset || 10;

        this.setAttrs({
            separationOffset: this.separationOffset,
            id: "arrow"
        });

        this.anchorCircles = [];

        this.stage.on("wheel", () => {
            this.updateArrow();
            this.layer.batchDraw();
        });

        this.layer.add(this);
        this.updateArrow();
    }

    private createAnchorCircle(x: number, y: number, index: number): Konva.Circle {
        const circle: Konva.Circle = new Konva.Circle({
            x,
            y,
            radius: 7 * this.stage.scaleX(),
            fill: 'white',
            stroke: this.stroke(),
            strokeWidth: 2 * this.stage.scaleX(),
            draggable: true,
            visible: true,
        });

        circle.on('dragmove', (e) => {
            const points = this.points();
            const newPos = this.stage.getPointerPosition();
            if (!newPos) return;

            if (index === 0) {
                if (Math.abs(points[2] - points[0]) > Math.abs(points[3] - points[1])) {
                    circle.y(newPos.y);
                    circle.x(x);
                } else {
                    circle.x(newPos.x);
                    circle.y(y);
                }
            } else {
                if (Math.abs(points[4] - points[2]) > Math.abs(points[5] - points[3])) {
                    circle.y(newPos.y);
                    circle.x(x);
                } else {
                    circle.x(newPos.x);
                    circle.y(y);
                }
            }

            this.updateArrowFromCircles();
            this.layer.batchDraw();
        });

        this.layer.add(circle);
        return circle;
    }

    private updateArrowFromCircles() {
        const points = this.points();
        const startPoint = [points[0], points[1]];
        const endPoint = [points[points.length - 2], points[points.length - 1]];
        
        const middlePoints = this.anchorCircles.flatMap(circle => [circle.x(), circle.y()]);
        
        this.points([...startPoint, ...middlePoints, ...endPoint]);
        this.setAttrs({
            pointerLength: 10 / this.customScale,
            pointerWidth: 10 / this.customScale,
            strokeWidth: 2 / this.customScale,
        });
    }

    private notIsRect(node: Konva.Node): boolean {
        return node.getClassName() === 'Circle' || node.getClassName() === 'RegularPolygon' || node.getClassName() === 'Diamond';
    }

    private getNodeDimensions(node: Konva.Node): { width: number, height: number } {
        if (this.notIsRect(node)) {
            const circle = node as Konva.Circle;
            const diameter = circle.radius() * 2;
            return { width: diameter, height: diameter };
        } else {
            return { width: node.width(), height: node.height() };
        }
    }

    private calculateArrowPosition(anchor: Konva.Node, anchorType: string) {
        const { width, height } = this.getNodeDimensions(anchor);
        let position: { x: number, y: number } = { x: anchor.x(), y: anchor.y() };

        switch (anchorType) {
            case 'left':
                if (this.notIsRect(anchor)) {
                    position.x -= width * anchor.scaleX() / 2 + this.separationOffset;
                    position.y = anchor.y();
                } else {
                    position.x -= this.separationOffset;
                    position.y += height * anchor.scaleY() / 2;
                }
                break;
            case 'right':
                if (this.notIsRect(anchor)) {
                    position.x += width * anchor.scaleX() / 2 + this.separationOffset;
                    position.y = anchor.y();
                } else {
                    position.x += width * anchor.scaleX() + this.separationOffset;
                    position.y += height * anchor.scaleY() / 2;
                }
                break;
            case 'top':
                if (this.notIsRect(anchor)) {
                    position.x = anchor.x();
                    position.y -= height * anchor.scaleY() / 2 + this.separationOffset;
                } else {
                    position.x += width * anchor.scaleX() / 2;
                    position.y -= this.separationOffset;
                }
                break;
            case 'bottom':
                if (this.notIsRect(anchor)) {
                    position.x = anchor.x();
                    position.y += height * anchor.scaleY() / 2 + this.separationOffset;
                } else {
                    position.x += width * anchor.scaleX() / 2;
                    position.y += height * anchor.scaleY() + this.separationOffset;
                }
                break;
        }

        return position;
    }
    
    private calculateMiddlePosition(startPos: {x: number, y: number}, endPos: {x: number, y: number}, anchorTypeA: string): {x: number, y: number} {
        let middleX, middleY;
        const heightDifference = endPos.y - startPos.y;
        const widthDifference = endPos.x - startPos.x;
    
        if (anchorTypeA === 'left' || anchorTypeA === 'right') {
            if (Math.abs(heightDifference) > Math.abs(widthDifference)) {
                middleX = startPos.x + widthDifference;
                middleY = startPos.y;
            } else {
                middleX = startPos.x;
                middleY = endPos.y;
            }
        } else {
            if (Math.abs(widthDifference) > Math.abs(heightDifference)) {
                middleX = startPos.x;
                middleY = startPos.y + heightDifference;
            } else {
                middleX = endPos.x;
                middleY = startPos.y;
            }
        }
    
        return {x: middleX, y: middleY};
    }

    public updateArrow() {
        const anchorA = this.getAttr("anchorA");
        const anchorTypeA = this.getAttr("anchorTypeA");
        const anchorB = this.getAttr("anchorB");
        const anchorTypeB = this.getAttr("anchorTypeB");
        
        if (!anchorA || !anchorB) return;

        const startPos = this.calculateArrowPosition(anchorA, anchorTypeA);
        const endPos = this.calculateArrowPosition(anchorB, anchorTypeB);
        const middlePos = this.calculateMiddlePosition(startPos, endPos, anchorTypeA);

        this.points([startPos.x, startPos.y, middlePos.x, middlePos.y, endPos.x, endPos.y]);
        this.setAttrs({
            pointerLength: 10 / this.customScale,
            pointerWidth: 10 / this.customScale,
            strokeWidth: 2 / this.customScale,
        });

        this.updateAnchorCircles();
    }

    private updateAnchorCircles() {
        this.anchorCircles.forEach(circle => circle.destroy());
        this.anchorCircles = [];

        const points = this.points();

        for (let i = 0; i < points.length - 2; i += 2) {
            const x1 = points[i];
            const y1 = points[i + 1];
            const x2 = points[i + 2];
            const y2 = points[i + 3];

            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            const anchorCircle = this.createAnchorCircle(midX, midY, i / 2);
            this.anchorCircles.push(anchorCircle);
        }
    }

    public initAnchors() {
        this.updateAnchorCircles();
    }

    public loadEvents() {
        this.attrs.anchorA.on('transform dragmove', () => {
            this.updateArrow();
            this.layer.batchDraw();
        });

        this.attrs.anchorB.on('transform dragmove', () => {
            this.updateArrow();
            this.layer.batchDraw();
        });
    }

    public destroyAnchors() {
        this.anchorCircles.forEach(circle => circle.destroy());
        this.anchorCircles = [];
    }

    public destroyArrow() {
        this.destroyAnchors();
        this.destroy();
    }
}