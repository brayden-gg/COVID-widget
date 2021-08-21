// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: purple; icon-glyph: stethoscope;

const LOCATIONS = ["US", "MA", "RI", "FL", "TX", "CA", "NY"];
const METRICS = ["Cases", "Deaths", "Vaccinations", "People Vaccinated", "People Fully Vaccinated"];
let metricEmojis = ["🦠", "💀", "💉", "💉🧍‍♂️", "✅💉"];
const getStateInfo = importModule("StateInfo.js");
const stateInfo = getStateInfo();
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
let beginDate = new Date("2020-01-21");
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
        getValue: (data, location, metric, widgetSize) => {
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
    week: {
        text: "Last 7 Days: ",
        getValue: (data, location, metric) => {
            let val = data[metric][data[metric].length - 1] - data[metric][data[metric].length - 1 - 7];
            return val.toLocaleString();
        },
    },
    yesterday: {
        text: "Yesterday: ",
        getValue: (data, location, metric) => {
            let val = data[metric][data[metric].length - 1] - data[metric][data[metric].length - 2];
            return val.toLocaleString();
        },
    },
    weekAverage: {
        text: "7 Day Average: ",
        getValue: (data, location, metric) => {
            let rolling = rollingAverage(data[metric], 7);
            return rolling[rolling.length - 1].toLocaleString();
        },
    },
};

async function getData(location, get) {
    let data = {
        Population: location == "US" ? 329227746 : stateInfo[location].pop,
    };

    const US_URL = "https://raw.githubusercontent.com/nytimes/covid-19-data/master/us.csv";
    const STATE_URL = "https://data.cdc.gov/resource/9mfq-cb36.json?state=" + location;
    // const US_VACCINE_URL = "https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/vaccinations/country_data/United%20States.csv";
    // const STATE_VACCINE_URL = "https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/vaccinations/us_state_vaccinations.csv";
    const VACCINE_URL = `https://data.cdc.gov/resource/unsk-b7fc.json?location=${location}`;

    const commasRegex = /,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/; // thanks stackoverflow (splits by commas but not in strings)

    if (get.includes("Vaccin") || get == "All") {
        let requestData = new Request(VACCINE_URL);
        let jsonData = await requestData.loadJSON();

        jsonData.sort((a, b) => new Date(a.date) - new Date(b.date));

        let recent = jsonData[jsonData.length - 1];

        data["Vaccinations"] = [];
        data["People Vaccinated"] = [];
        data["People Fully Vaccinated"] = [];

        data["Total Vaccinations"] = +recent.administered;
        data["Total People Vaccinated"] = +recent.administered_dose1_recip;
        data["Total People Fully Vaccinated"] = +recent.series_complete_yes;

        let mostRecentDate = new Date(recent.date);

        for (let date = new Date(beginDate.valueOf()); date < mostRecentDate; date.setDate(date.getDate() + 1)) {
            let i = jsonData.findIndex(e => Math.abs(new Date(e.date) - date) <= 60 * 60 * 1000 * 12);

            if (!jsonData[i] || !jsonData[i].recip_administered || !jsonData[i].administered_dose1_recip || !jsonData[i].series_complete_yes) {
                data["Vaccinations"].push(Math.max(...data["Vaccinations"]) || 0);
                data["People Vaccinated"].push(Math.max(...data["People Vaccinated"]) || 0);
                data["People Fully Vaccinated"].push(Math.max(...data["People Fully Vaccinated"]) || 0);
                continue;
            }

            data["Vaccinations"].push(+jsonData[i].administered || 0);
            data["People Vaccinated"].push(+jsonData[i].administered_dose1_recip || 0);
            data["People Fully Vaccinated"].push(+jsonData[i].series_complete_yes || 0);
        }
    }

    if (get == "All" || get == "Cases" || get == "Deaths") {
        data.Cases = [];
        data.Deaths = [];

        if (location != "US") {
            let requestData = new Request(STATE_URL);
            let jsonData = await requestData.loadJSON();

            jsonData.sort((a, b) => new Date(a.submission_date) - new Date(b.submission_date));

            let recent = jsonData[jsonData.length - 1];
            data["Total Cases"] = +recent.tot_cases;
            data["Total Deaths"] = +recent.tot_death;

            let mostRecentDate = new Date(recent.submission_date);

            for (let date = new Date(beginDate.valueOf()); date < mostRecentDate; date.setDate(date.getDate() + 1)) {
                let i = jsonData.findIndex(e => Math.abs(new Date(e.submission_date) - date) <= 60 * 60 * 1000 * 12);

                if (!jsonData[i] || !jsonData[i].tot_cases || !jsonData[i].tot_death) {
                    data.Cases.push(Math.max(...data.Cases) || 0);
                    data.Deaths.push(Math.max(...data.Deaths) || 0);
                    continue;
                }

                data.Cases.push(+jsonData[i].tot_cases);
                data.Deaths.push(+jsonData[i].tot_death);
            }
        } else {
            let requestData = new Request(US_URL);
            let rawData = await requestData.loadString();
            let rowsData = rawData.split("\n").slice(1);

            let recent = rowsData[rowsData.length - 1].split(commasRegex);

            data["Total Cases"] = +recent[1];
            data["Total Deaths"] = +recent[2];

            let mostRecentDate = new Date(recent[0]);

            for (let date = new Date(beginDate.valueOf()); date < mostRecentDate; date.setDate(date.getDate() + 1)) {
                let i = rowsData.findIndex(e => Math.abs(new Date(e.split(commasRegex)[0]) - date) <= 60 * 60 * 1000 * 12);
                let current = rowsData[i]?.split(commasRegex);

                if (!current || !current[0] || !current[1]) {
                    data.Cases.push(Math.max(...data.Cases) || 0);
                    data.Deaths.push(Math.max(...data.Deaths) || 0);
                    continue;
                }
                //        data.date.push(new Date(current[0]));
                data.Cases.push(current[1]);
                data.Deaths.push(current[2]);
            }
        }
    }

    return data;
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
    } else if (currentMetric == "Cases") {
        color = Color.purple();
    } else {
        color = Color.red();
    }

    drawGraph(canvas, rollingAverage(data[metric], 7), color);

    canvas.setFont(Font.boldSystemFont(12));
    canvas.drawTextInRect(`${location} ${metric}:`, new Rect(2, 2, 200, 15));

    canvas.setFont(Font.regularSystemFont(12));
    canvas.drawTextInRect(info.total.getValue(data, location, metric, widgetSize), new Rect(2, 14, 500, 15));

    canvas.setFont(Font.boldSystemFont(12));
    canvas.drawTextInRect("Daily:", new Rect(2, 28, 200, 15));

    canvas.setFont(Font.regularSystemFont(12));
    canvas.drawTextInRect(info.weekAverage.getValue(data, location, metric, widgetSize), new Rect(2, 40, 200, 15));

    const canvImage = canvas.getImage();

    let image = widget.addImage(canvImage);
    image.centerAlignImage();

    //background image

    let fm = FileManager.iCloud();
    let end = widgetSize == "small" ? "BGMiddleLeft" : "BG";
    let path = fm.documentsDirectory() + "/" + widgetSize + end + ".jpg";
    await fm.downloadFileFromiCloud(path);
    let img = fm.readImage(path);
    widget.backgroundImage = img;

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

function drawGraphWithAxes(data, color, canvas, globalMax, index) {
    canvas.setFillColor(Color.black());

    canvas.setTextColor(Color.white());

    let max = Math.max(...data);

    let plot = (x, y) => [mapRange(x, 0, data.length, 0, canvas.size.width - 5), mapRange(y, 0, globalMax, 95, 5)];

    canvas.setLineWidth(1);
    canvas.setFontSize(8);
    let [maxX, maxY] = plot(data.indexOf(max), max);
    let maxDate = new Date(beginDate.valueOf() + data.indexOf(max) * 60 * 60 * 24 * 1000);

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
        header.addText(currentMetric + " per 100,000");
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
        let data = rollingAverage(savedData[location][currentMetric], 7).map(e => (e / stateInfo[location].pop) * 100000);
        // .slice(xOffset, xOffset + xScale);
        globalMax = Math.max(globalMax, Math.max(...data));
    }

    for (let location of toggledLocations) {
        let color;

        if (currentMetric.includes("Vacc")) {
            color = vaccineColors[toggledLocations.indexOf(location)];
        } else if (currentMetric == "Cases") {
            color = casesColors[toggledLocations.indexOf(location)];
        } else {
            color = deathsColors[toggledLocations.indexOf(location)];
        }

        drawGraphWithAxes(
            rollingAverage(savedData[location][currentMetric], 7)
                .map(e => (e / stateInfo[location].pop) * 100000)
                .slice(xOffset, xOffset + xScale),
            color,
            canvas,
            globalMax,
            toggledLocations.indexOf(location)
        );
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
        } else if (currentMetric == "Cases") {
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
            row.addText(info[key].text + info[key].getValue(savedData[location], location, currentMetric));

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
                if (arr[j] && arr[j - 1]) {
                    total += arr[j] - arr[j - 1];
                    count++;
                }
            }

            return Math.round(total / count) || 0;
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

    let widget = await makeWidget(config.widgetFamily, toggledLocations[0], currentMetric);
    // widget.present();
    Script.setWidget(widget);

    Script.complete();
} else {
    let table = new UITable();
    addMenu(table);
    table.present();
}
