// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: purple; icon-glyph: stethoscope;

const LOCATIONS = ["US", "MA", "RI", "FL", "TX", "CA", "NY"];
const METRICS = ["Cases", "Deaths", "Infection Rate", "People Vaccinated", "People Fully Vaccinated"];
let metricEmojis = ["Cases", "Deaths", "Infection Rate", "💉", "✅💉"];
const getStateInfo = importModule("StateInfo.js");
const stateInfo = getStateInfo();
const getEnv = importModule("getEnv.js");
const env = getEnv();

let xScale;
let maxScale;
let xOffset = 0;

let vaccineColors = [Color.green(), Color.cyan(), Color.blue(), new Color("#3CB043"), new Color("#63C5DA"), new Color("#1338BE")];
let casesColors = [Color.purple(), Color.magenta(), Color.blue(), new Color("#A1045A"), new Color("#A32CC4"), new Color("#051094")];
let deathsColors = [Color.red(), Color.orange(), Color.yellow(), new Color("#B90E0A"), new Color("#FCAE1E"), new Color("#FDE992")];

let savedData = {};

// let X_SCALE = 365; // how many days to range from
let currentMetric = METRICS[0];
let toggledLocations = [];
// let beginDate = new Date("2020-01-21");
// beginDate.setDate(beginDate.getDate() - X_SCALE);

let outOf = {
    //populations to get percentages of
    Cases: "Population",
    Deaths: "Total Cases",
    Vaccinations: null,
    "People Vaccinated": "Population",
    "People Fully Vaccinated": "Population",
};

let info = {
    total: {
        text: "Total: ",
        getValue: (data, metric, widgetSize) => {
            let val = data["Total " + metric];
            let comments = "";
            let population = outOf[metric];
            if (population) {
                let percent = (val / data[population]) * 100;
                comments = `(${percent.toFixed(2)}%${widgetSize != "small" ? " " + population : ""})`;
            }

            return `${val.toLocaleString()} ${comments}`;
        },
    },
    yesterday: {
        text: "Yesterday: ",
        getValue: (data, metric) => {
            let notNull = data[metric].filter(e => e);
            let val = notNull[notNull.length - 1];
            return val.toLocaleString();
            // return "";
        },
    },
    weekAverage: {
        text: "7 Day Average: ",
        getValue: (data, metric) => {
            let rolling = rollingAverage(data[metric], 7);
            // return "";
            return Math.round(rolling[rolling.length - 1]).toLocaleString();
        },
    },
};

async function getData(location, get) {
    const URL = `https://api.covidactnow.org/v2/${location == "US" ? "country" : "state"}/${location}.timeseries.json?apiKey=${env.COVID_API_KEY}`;
    let req = new Request(URL);
    let json = await req.loadJSON();

    return {
        "Total Cases": json.actuals.cases,
        "Total Deaths": json.actuals.deaths,

        Cases: json.actualsTimeseries.map(e => e.newCases),
        Deaths: json.actualsTimeseries.map(e => e.newDeaths),

        Vaccinations: json.actualsTimeseries.map((e, i, arr) => (e.vaccinesAdministered && arr[i - 1] && arr[i - 1].vaccinesAdministered ? e.vaccinesAdministered - arr[i - 1].vaccinesAdministered : null)),
        "People Vaccinated": json.actualsTimeseries.map((e, i, arr) => (e.vaccinationsInitiated && arr[i - 1] && arr[i - 1].vaccinationsInitiated ? e.vaccinationsInitiated - arr[i - 1].vaccinationsInitiated : null)),
        "People Fully Vaccinated": json.actualsTimeseries.map((e, i, arr) => (e.vaccinationsCompleted && arr[i - 1] && arr[i - 1].vaccinationsCompleted ? e.vaccinationsCompleted - arr[i - 1].vaccinationsCompleted : null)),

        "Total Vaccinations": json.actuals.vaccinesAdministered,
        "Total People Vaccinated": json.actuals.vaccinationsInitiated,
        "Total People Fully Vaccinated": json.actuals.vaccinationsCompleted,

        "Infection Rate": json.metricsTimeseries.map(e => e.infectionRate),
        "Total Infection Rate": NaN,

        Population: json.population,
        dates: json.actualsTimeseries.map(e => new Date(e.date)),
    };
}

async function makeWidget(widgetSize, location, metric, data) {
    let widget = new ListWidget();
    widget.setPadding(0, 0, 0, 0);

    let canvas = new DrawContext();
    canvas.opaque = false;
    let canvasSize = widgetSize == "large" ? 200 : 100;
    canvas.size = new Size(canvasSize * (widgetSize == "medium" ? 2 : 1), canvasSize);
    canvas.respectScreenScale = true;
    canvas.setFillColor(Color.black());

    canvas.setTextColor(Color.white());

    if (!data) {
        data = await getData(location, metric);
    }

    let color;
    if (currentMetric.includes("Vacc")) {
        color = Color.green();
    } else if (currentMetric == "Cases" || currentMetric == "Infection Rate") {
        color = Color.purple();
    } else {
        color = Color.red();
    }

    drawGraph(canvas, rollingAverage(data[metric], 14), color);

    canvas.setFont(Font.boldSystemFont(12));
    canvas.drawTextInRect(`${location} ${metric}:`, new Rect(2, 2, 200, 15));

    if (data["Total " + metric]) {
        canvas.setFont(Font.regularSystemFont(12));
        canvas.drawTextInRect(info.total.getValue(data, metric, widgetSize), new Rect(2, 14, 500, 15));
    }
    canvas.setFont(Font.boldSystemFont(12));
    canvas.drawTextInRect("Daily:", new Rect(2, 28, 200, 15));

    canvas.setFont(Font.regularSystemFont(12));
    canvas.drawTextInRect(info.weekAverage.getValue(data, metric, widgetSize), new Rect(2, 40, 200, 15));

    const canvImage = canvas.getImage();

    let image = widget.addImage(canvImage);
    image.centerAlignImage();

    //background image

    let fm = FileManager.iCloud();
    let end = widgetSize == "small" ? "BGMiddleLeft" : "BG";
    let path = fm.documentsDirectory() + "/" + widgetSize + end + ".jpg";
    try {
        await fm.downloadFileFromiCloud(path);
        let img = fm.readImage(path);
        widget.backgroundImage = img;
    } catch (e) {
        console.log("no file");
    }

    return widget;
}

function drawGraph(canvas, data, color, globalMax) {
    let max = globalMax || Math.max(...data);
    // let min = Math.min(...data);

    canvas.setStrokeColor(color);
    canvas.setLineWidth(2);

    let path = new Path();

    let oldPt;

    for (let i = 0; i < data.length; i++) {
        if (data[i] == null) {
            continue;
        }
        let pt = new Point(mapRange(i, 0, data.length, 0, canvas.size.width - 5), mapRange(data[i], 0, max, 95, 5));
        path.move(pt);
        if (oldPt) {
            path.addLine(oldPt);
        }
        oldPt = pt;
    }
    canvas.addPath(path);
    canvas.strokePath();
}

function drawGraphWithAxes(data, color, canvas, globalMax, dates, index) {
    canvas.setFillColor(Color.black());

    canvas.setTextColor(Color.white());

    let max = Math.max(...data);

    let plot = (x, y) => [mapRange(x, 0, data.length, 0, canvas.size.width - 5), mapRange(y, 0, globalMax, 95, 5)];

    canvas.setLineWidth(1);
    canvas.setFontSize(8);
    let [maxX, maxY] = plot(data.indexOf(max), max);
    let maxDate = new Date(dates[data.indexOf(max)]);

    canvas.setStrokeColor(new Color(color.hex, 0.5));
    canvas.strokeRect(new Rect(0, maxY, maxX, 0));
    canvas.strokeRect(new Rect(maxX, maxY, 0, 9000));

    drawGraph(canvas, data, color, globalMax);

    // canvas.setStrokeColor(new Color("#FFF", 0.4));
    // canvas.strokeRect(new Rect(0, currentY, currentX, 0));

    if (maxX > canvas.size.width / 2) {
        canvas.setTextAlignedRight();
        canvas.drawTextInRect(maxDate.toLocaleDateString(), new Rect(0, canvas.size.height - 10 * (index + 1), maxX - 2, 100));
    } else {
        canvas.setTextAlignedLeft();
        canvas.drawTextInRect(maxDate.toLocaleDateString(), new Rect(maxX + 2, canvas.size.height - 10 * (index + 1), 100, 100));
    }

    canvas.drawText(max.toLocaleString(), new Point(0, constrain(maxY, 0, canvas.size.height - 8)));
    // canvas.drawText(data[data.length - 1].toLocaleString(), new Point(canvas.size.width / 2, constrain(currentY, 0, canvas.size.height - 8)));
    // console.log(maxX, maxY);
}

async function addGraphsToTable(table) {
    if (toggledLocations.length > 0) {
        let header = new UITableRow();
        header.isHeader = true;
        header.addText(currentMetric + (Object.keys(outOf).includes(currentMetric) ? " per 100,000" : ""));
        table.addRow(header);
    }

    let canvas = new DrawContext();
    canvas.opaque = false;
    canvas.size = new Size(400, 100);
    canvas.respectScreenScale = true;

    let globalMax = 0;

    for (let location of toggledLocations) {
        if (!savedData[location]) {
            savedData[location] = await getData(location, "All");
        }
        if (!xScale) {
            maxScale = savedData[location][currentMetric].length;
            xScale = maxScale;
        }
        let data = rollingAverage(savedData[location][currentMetric], 14); // .map(e => (e / stateInfo[location].pop) * 100000);
        // .slice(xOffset, xOffset + xScale);
        if (Object.keys(outOf).includes(currentMetric)) {
            data = data.map(e => (e / savedData[location].Population) * 100000);
        }

        globalMax = Math.max(globalMax, Math.max(...data));
    }

    for (let location of toggledLocations) {
        let color;

        if (currentMetric.includes("Vacc")) {
            color = vaccineColors[toggledLocations.indexOf(location)];
        } else if (currentMetric == "Cases" || currentMetric == "Infection Rate") {
            color = casesColors[toggledLocations.indexOf(location)];
        } else {
            color = deathsColors[toggledLocations.indexOf(location)];
        }

        let data = rollingAverage(savedData[location][currentMetric], 14)
            //.map(e => (e / stateInfo[location].pop) * 100000)
            .slice(xOffset, xOffset + xScale);

        if (Object.keys(outOf).includes(currentMetric)) {
            data = data.map(e => (e / savedData[location].Population) * 100000);
        }

        drawGraphWithAxes(data, color, canvas, globalMax, savedData[location].dates.slice(xOffset, xOffset + xScale), toggledLocations.indexOf(location));
    }
    let graphRow = new UITableRow();
    graphRow.addImage(canvas.getImage());
    graphRow.height = 180;
    table.addRow(graphRow);
}

function addSummariesToTable(table) {
    for (let location of toggledLocations) {
        if (currentMetric.includes("Vacc")) {
            color = vaccineColors[toggledLocations.indexOf(location)];
        } else if (currentMetric == "Cases" || currentMetric == "Infection Rate") {
            color = casesColors[toggledLocations.indexOf(location)];
        } else {
            color = deathsColors[toggledLocations.indexOf(location)];
        }

        let header = new UITableRow();
        header.isHeader = true;
        let text = header.addText(location + " " + currentMetric);
        text.titleColor = color;
        table.addRow(header);

        for (let key in info) {
            let row = new UITableRow();
            row.addText(info[key].text + info[key].getValue(savedData[location], currentMetric));

            table.addRow(row);
        }
    }
}

async function refreshTable(table) {
    table.removeAllRows();
    addMenu(table);

    if (toggledLocations.length > 0) {
        await addGraphsToTable(table);
        addZoomControlsToTable(table);
        addSummariesToTable(table);
    }
    table.reload();
}

function addZoomControlsToTable(table) {
    let zoomRow = new UITableRow();

    let panBeginning = zoomRow.addButton("⏮");
    panBeginning.onTap = async () => {
        xOffset = 0;
        await refreshTable(table);
    };
    panBeginning.centerAligned();

    let panLeft = zoomRow.addButton("⏪");
    panLeft.onTap = async () => {
        xOffset = Math.max(0, Math.floor(xOffset - xScale / 10));
        await refreshTable(table);
    };
    panLeft.centerAligned();

    let zoomOut = zoomRow.addButton("-");
    zoomOut.onTap = async () => {
        let newScale = Math.min(maxScale, Math.floor(xScale * 1.4));
        xOffset -= Math.ceil((newScale - xScale) / 2);
        if (xOffset < 0) {
            xOffset = 0;
        }
        xScale = newScale;

        await refreshTable(table);
    };
    zoomOut.centerAligned();

    let zoomIn = zoomRow.addButton("+");
    zoomIn.onTap = async () => {
        let newScale = Math.max(10, Math.floor(xScale * 0.6));
        xOffset += Math.floor((xScale - newScale) / 2);
        xScale = newScale;

        await refreshTable(table);
    };
    zoomIn.centerAligned();

    let panRight = zoomRow.addButton("⏩");
    panRight.onTap = async () => {
        xOffset = Math.min(maxScale - xScale, Math.floor(xOffset + xScale / 10));
        await refreshTable(table);
    };
    panRight.centerAligned();

    let panEnd = zoomRow.addButton("⏭");
    panEnd.onTap = async () => {
        xOffset = maxScale - xScale;
        await refreshTable(table);
    };
    panEnd.centerAligned();

    table.addRow(zoomRow);
}

function addMenu(table) {
    let header = new UITableRow();
    header.isHeader = true;
    let headerText = header.addText("Select a Location:");
    headerText.centerAligned();
    table.addRow(header);
    let locationRow = new UITableRow();
    // add top row for locations
    for (let location of LOCATIONS) {
        let selectedEmoji = toggledLocations.includes(location) ? "🔘" : "⚪️";
        let cell = locationRow.addButton(selectedEmoji + " " + location);
        cell.onTap = async () => {
            if (toggledLocations.includes(location)) {
                // already present: remove it
                toggledLocations.splice(toggledLocations.indexOf(location), 1);
            } else {
                toggledLocations.push(location);
            }

            await refreshTable(table);
        };
        cell.centerAligned();
    }
    table.addRow(locationRow);

    let metricRow = new UITableRow();
    // fill data
    for (let i = 0; i < METRICS.length; i++) {
        let cell = metricRow.addButton(metricEmojis[i]);
        cell.onTap = async () => {
            currentMetric = METRICS[i];

            await refreshTable(table);
        };
        if (currentMetric == METRICS[i]) {
            cell.titleColor = Color.red();
        }
        cell.centerAligned();
    }
    table.addRow(metricRow);
}

//helper functions
function rollingAverage(arr, win) {
    return arr
        .map((e, i) => {
            if (i < win) return null;

            let total = 0;
            let count = 0;

            for (let j = i - win; j < i; j++) {
                if (arr[j]) {
                    total += arr[j];
                    count++;
                }
            }

            if (count == 0) {
                return null;
            }

            return total / count || 0;
        })
        .slice(win);
}

function mapRange(val, oldMin, oldMax, newMin, newMax) {
    let oldRange = oldMax - oldMin;
    let newRange = newMax - newMin;

    let unshift = val - oldMin;
    let unsqueeze = unshift / oldRange;
    let resqueeze = unsqueeze * newRange;
    let reshift = resqueeze + newMin;

    return reshift;
}

function constrain(val, min, max) {
    return Math.max(Math.min(val, max), min);
}

if (config.runsInWidget) {
    if (args.widgetParameter) {
        let split = args.widgetParameter.split(" ");

        if (split.length > 1) {
            toggledLocations.push(split[0]);
            let rest = split.slice(1).join(" ");
            currentMetric = rest ? rest : currentMetric;
        } else {
            currentMetric = args.widgetParameter;
        }
    } else {
        toggledLocations = ["US"];
        currentMetric = "Cases";
    }

    let widget = await makeWidget(config.widgetFamily || "Medium", toggledLocations[0], currentMetric);
    // widget.presentMedium();
    Script.setWidget(widget);

    Script.complete();
} else {
    let table = new UITable();
    addMenu(table);
    table.present();
}
