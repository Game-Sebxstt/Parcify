import Konva from 'konva';

interface ConfigCursor {
    fill: string;
    radius: number;
    x: number;
    y: number;
    draggable: boolean;
    visible: boolean;
    stroke: string;
    strokeWidth: number;
    id: string;
    id_user: string;
    name_user: string;
    font_size: number;
}

export class CustomCursor {

    private options: ConfigCursor;
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private cursor: Konva.Circle | null = null;
    private name: Konva.Text | null = null;
    private id: string;
    private id_user: string;
    private scale: number = 1;

    constructor(options: ConfigCursor, layer: Konva.Layer, stage: Konva.Stage) {
        this.options = options;
        this.stage = stage;
        this.layer = layer;
        this.id = options.id;
        this.id_user = options.id_user;

        this.createCursor();
        this.eventsGlobal();
    }

    private createCursor() {
        this.cursor = new Konva.Circle({
            radius: this.options.radius,
            fill: this.options.fill,
            stroke: this.options.stroke,
            strokeWidth: this.options.strokeWidth,
            draggable: this.options.draggable,
            x: this.options.x,
            y: this.options.y,
            visible: this.options.visible
        });

        this.name = new Konva.Text({
            x: this.options.x,
            y: this.options.y - this.options.font_size,
            text: this.options.name_user,
            fontSize: this.options.font_size,
            fontFamily: 'Calibri',
            fill: 'white',
            align: 'center',
            visible: this.options.visible,
        });

        this.layer.add(this.cursor);
        this.layer.add(this.name);
        this.layer.draw();
    }

    private updateScale() {
        this.scale = this.stage.scaleX() > 1 ? this.stage.scaleX() : 1;
    }

    private updateScaleCursor() {
        if(!this.options.radius || !this.options.strokeWidth || !this.cursor || !this.name) return;
        console.log(this.cursor)

        this.cursor.radius(this.options.radius);
        this.cursor.strokeWidth(this.options.strokeWidth);
        this.name.fontSize(this.name.fontSize());

        this.layer.batchDraw();
    }

    private eventsGlobal() {
        this.stage.on('wheel', () => {
            this.updateScale();
            this.updateScaleCursor();
        });
    }

    public updateCursor(options: ConfigCursor) {
        this.options = options;

        if (this.cursor) {
            this.cursor.position({
                x: this.options.x,
                y: this.options.y,
            });
            this.name?.position({
                x: this.options.x - this.name.width() / 2,
                y: this.options.y - this.name.height() - this.cursor.radius() * 2,
            });

            this.cursor.visible(true);
            this.name?.visible(true);
            this.updateScaleCursor();
            this.layer.draw();
        }
    }

    public removeCursor() {
        this.cursor?.destroy();
        this.name?.destroy();
        this.layer.draw();
    }
}
