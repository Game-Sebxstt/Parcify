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
}

export class CustomCursor {

    private options: ConfigCursor;
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private cursor: Konva.Circle | null = null;
    private name: Konva.Text | null = null;
    private id: string;
    private id_user: string;
    private scaleX: number = 1;
    private scaleY: number = 1;

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
        this.cursor = new Konva.Circle(this.options || {
            radius: 5,
            fill: 'red',
            stroke: 'black',
            strokeWidth: 1,
            draggable: true,
        });

        this.name = new Konva.Text({
            x: this.options.x + 10,
            y: this.options.y - 10,
            text: this.options.name_user,
            fontSize: 10,
            fontFamily: 'Calibri',
            fill: 'white',
            visible: false,
        })

        this.layer.add(this.cursor);
        this.layer.add(this.name);
        this.layer.draw();
    }

    private updateScale() {
        this.scaleX = this.stage.scaleX();
        this.scaleY = this.stage.scaleY();
    }

    private updateScaleCursor() {
        this.cursor?.scale({
            x: 5 / this.scaleX,
            y: 5 / this.scaleY,
        });
        this.layer.draw();
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
                x: this.options.x + 10,
                y: this.options.y - 10,
            });

            this.cursor.visible(true);
            this.name?.visible(true);
            this.layer.draw();
        }
    }

    public removeCursor() {
        this.cursor?.destroy();
        this.name?.destroy();
        this.layer.draw();
    }
}
