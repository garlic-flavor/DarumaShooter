// jQuery required.
// jQueryUI required.
// SunCalc required. (http://suncalc.net)
// google.maps API required.
// google.maps.geometry API required.

var elevator;
var infoWindow;

var marker;
var sunriseMarker;
var sunriseDaruMarker;
var sunsetMarker;
var sunsetDaruMarker;

var sunrisePath;
var sunsetPath;

var EARTH_R = 6371000.0;    // 地球の半径(単位:m)
var EYE_HEIGHT = 1.7;       // 目の高さ(単位:m)
var MAX_DISTANCE = 200000;  // MAX_DISTANCEまで標高を調べる。(単位:m)
var DENSITY = 2000;         // DENSITY毎に標高を調べる。(単位:m)
var DARUMA_DISTANCE = EARTH_R * Math.acos(EARTH_R / (EYE_HEIGHT + EARTH_R));


//------------------------------------------------------------------------------
// SunCalc呼び出し
function calcSunInfo(date, lat, lng) {
    var times = SunCalc.getTimes(date, lat, lng);
    var sunrisePos = SunCalc.getPosition(times.sunrise, lat, lng);
    var sunsetPos = SunCalc.getPosition(times.sunset, lat, lng);

    return {
        sunrise: ("0" + times.sunrise.getHours()).slice(-2) + ":"
            + ("0" + times.sunrise.getMinutes()).slice(-2),
        sunset: ("0" + times.sunset.getHours()).slice(-2) + ":"
            + ("0" + times.sunset.getMinutes()).slice(-2),
        sunriseAzimuth: 180 + sunrisePos.azimuth * 180 / Math.PI,
        sunsetAzimuth: 180 + sunsetPos.azimuth * 180 / Math.PI,
    };
}

// from から to の位置が見かけ上水平線より高く見えるか。
// (地球を球と仮定した場合)
function calcHeightInSight(from, to, height) {
    var distance = google.maps.geometry.spherical.computeDistanceBetween(
        from, to);

    return EARTH_R - EARTH_R/Math.cos(distance/EARTH_R) + height - EYE_HEIGHT;
}

// 山の上に太陽がくるかどうか。
function calcHolizontalSun(els, start, delta) {
    var maxpoint = null;
    for (var i = 1; i < els.length; ++i) {
        var p = start + delta * i;

        var h = calcHeightInSight(
            els[start].location, els[p].location, els[p].elevation);

        if (!maxpoint || maxpoint.height < h) {
            maxpoint = { height: h, location: els[p].location };
        }
    }
    return maxpoint;
}

//------------------------------------------------------------------------------
// google.maps 呼び出し関連

// from から heading(真北から時計回り、単位:°)で、distance(単位:m)まで、
// density(単位:m)毎に直線を引く。(density いらんかも)
function makePath(from, heading, distance, density) {
    var count = Math.floor(distance / density) + 1;
    var path = new Array(count);
    var ll = new google.maps.LatLng({lat: from.lat(), lng: from.lng()});
    path[0] = ll;
    for (var i = 1; i < count; ++i) {
        ll = google.maps.geometry.spherical.computeOffset(
            ll, density, heading);
        path[i] = ll;
    }
    return path;
}


// google.maps.ElevationService を利用し、path に沿って標高を得る。
function queryElevation(path, samples, callback){
    if (!elevator) {
        elevator = new google.maps.ElevationService();
    }
    elevator.getElevationAlongPath({path: path, samples: samples}, callback);
}

// 地図上に線を引く
function drawLine(map, line, path, color, weight) {

    if (!line) {
        line = new google.maps.Polyline({
            path: path,
            geodesic: true,
            strokeColor: color,
            strokeOpacity: 1.0,
            strokeWeight: weight,
            clickable: false,
            map: map,
        });
    } else {
        line.setPath(path);
    }

    return line;
}

// マーカー上部のバルーンを開く。
function openInfoWindow(map, marker, cont) {
    if (!infoWindow) {
        infoWindow = new google.maps.InfoWindow({
            size: new google.maps.Size(150, 200)
        });
    }

    infoWindow.setContent(cont);
    infoWindow.open(map, marker);
}


// マーカーの位置を設定する。
function setMarkerPos(map, marker, latlng, draggable = false,
                     initializer) {
    if (!marker) {
        marker = new google.maps.Marker({
            position: latlng,
            map: map,
            draggable: draggable,
        });
        if (initializer){ initializer(marker); }
    } else {
        marker.setPosition(latlng);
        if (!marker.getVisible())
            marker.setVisible(true);
    }
    return marker;
}

//------------------------------------------------------------------------------
// 達磨情報の更新
function updateDaruma(map, latlng, sunInfo) {
    var path = new Array(3);

    // 日没地点
    path[0] = google.maps.geometry.spherical.computeOffset(
        latlng, MAX_DISTANCE, sunInfo.sunsetAzimuth);
    // 現在地
    path[1] = latlng;
    // 日の出地点
    path[2] = google.maps.geometry.spherical.computeOffset(
        latlng, MAX_DISTANCE, sunInfo.sunriseAzimuth);

    // 緑線
    sunsetPath = drawLine(map, sunsetPath, path.slice(0, 2), "#00FF00", 2);
    // 赤線
    sunrisePath = drawLine(map, sunrisePath, path.slice(-2), "#FF0000", 2);

    var samples = Math.floor(MAX_DISTANCE / DENSITY) * 2 + 1;

    // 標高問い合わせ
    queryElevation(path, samples, function(elevations, status) {
        if (status != "OK") {
            window.alert("標高の取得に失敗しました。");
            return;
        }

        var center = Math.floor(MAX_DISTANCE / DENSITY);

        var maxpoint = calcHolizontalSun(
            elevations.slice(0, center+1), center, -1);

        // 日の入り
        if (maxpoint && 0 < maxpoint.height) {
            sunsetMarker = setMarkerPos(
                map, sunsetMarker, maxpoint.location, false, function(m){
                    m.setIcon("./img/nondarumapin.svg");
                });
            if (sunsetDaruMarker) {
                sunsetDaruMarker.setVisible(false);
            }
        } else {
            var sunsetDaruPos = google.maps.geometry.spherical.computeOffset(
                latlng, DARUMA_DISTANCE, sunInfo.sunsetAzimuth);
            sunsetDaruMarker = setMarkerPos(
                map, sunsetDaruMarker, sunsetDaruPos, false, function(m){
                    m.setIcon("./img/darumapin.svg");
                });

            if (sunsetMarker) {
                sunsetMarker.setVisible(false);
            }
        }

        // 日の出
        maxpoint = calcHolizontalSun(elevations.slice(-center-1), 0, 1);
        if (maxpoint && 0 < maxpoint.height) {
            sunriseMarker = setMarkerPos(
                map, sunriseMarker, maxpoint.location, false, function(m){
                    m.setIcon("./img/nondarumapin.svg");
                });
            if (sunriseDaruMarker) {
                sunriseDaruMarker.setVisible(false);
            }
        } else {

            var sunriseDaruPos = google.maps.geometry.spherical.computeOffset(
                latlng, DARUMA_DISTANCE, sunInfo.sunriseAzimuth);
            sunriseDaruMarker = setMarkerPos(
                map, sunriseDaruMarker, sunriseDaruPos, false, function(m){
                    m.setIcon("./img/darumapin.svg");
                });

            if (sunriseMarker) {
                sunriseMarker.setVisible(false);
            }
        }
    });
}

//------------------------------------------------------------------------------
// 現在地マーカーの更新
function updateMarker(map, latlng, dragend){
    var date = getSelectedDate();
    var sunInfo = calcSunInfo(date, latlng.lat(), latlng.lng());

    var infoString = "<b>Location</b><br>" + latlng + "<br>"
        + "<b>Date :</b>" + $("#datepicker").prop("value") + "<br>"
        + "<b>Sunrise :</b>" + sunInfo.sunrise + "<br>"
        + "<b>Sunset :</b>" + sunInfo.sunset + "<br>"
        + "<b>Sunrise azimuth :</b>" + sunInfo.sunriseAzimuth + "<br>"
        + "<b>Sunset azimuth :</b>" + sunInfo.sunsetAzimuth;

    marker = setMarkerPos(map, marker, latlng, true, function(m) {
        google.maps.event.addListener(m, 'click', function(){
            openInfoWindow(map, m, infoString);
        });

        google.maps.event.addListener(m, 'dragend', function(event) {
            updateMarker(map, event.latLng, true);
        });
    });

    openInfoWindow(map, marker, infoString);

    updateDaruma(map, latlng, sunInfo);
}

//------------------------------------------------------------------------------
// about UI
function menuOnClick() {
    $m = $("#map");
    $sp = $("#settingPain");

    if ($sp.css("display") == "none")
    {
        $sp.css({
            display: "block",
        });

        var off = $sp.offset();
        w = Math.floor(($m.innerWidth() - off.left) * 0.9);
        h = Math.floor(($m.innerHeight() - off.top) * 0.9);

        $sp.css({
            width: w,
            height: h,
        });
    } else {
        $sp.css("display", "none");
        if (marker){
            updateMarker(map, marker.getPosition(), true);
        }
    }
}

function getSelectedDate(){
    date = $("#datepicker").prop("value").split("/");
    return new Date(date[2], parseInt(date[0]) - 1, date[1]);
}

//
function initUI($div, map) {
    //
    var $menuButton = $("<button>");
    $menuButton.html("<img src='./img/gear.png' alt='Setting'/>");
    $menuButton.click(menuOnClick);
    $div.append($menuButton);

    //
    var $settingPain = $("<div>");
    $settingPain.css({
        display: "none",
        border: "1px solid",
        "background-color": "white",
    });
    $settingPain.prop("id", "settingPain");

    // 日付選択
    {
        var $dateOuter = $("<p>");
        var $dateSel = $("<input>");
        var today = new Date();
        $dateSel.prop({
            type: "text",
            id: "datepicker",
            value: ("0" + (today.getMonth() + 1)).slice(-2) + "/"
                + ("0" + today.getDate()).slice(-2) + "/"
                + today.getFullYear(),
        });
        $dateSel.datepicker();

        $dateOuter.append($("<span>Date: </span>"));
        $dateOuter.append($dateSel);
        $settingPain.append($dateOuter);
    }

    // 謝辞
    {
        var $Acknowledgement = $("<p>");
        $Acknowledgement.html("<b>Acknowledgements:</b><br>" +
                              "<b>This module depends on belows.</b><br>" +
                              "<a href='https://developers.google.com/maps/'>Google Maps API(https://developers.google.com/maps/)</a> to display map.<br>" +
                              "<a href='https://github.com/mourner/suncalc'>SunCalc(https://github.com/mourner/suncalc)</a> to calculate sun informations.<br>" +
                              "<a href='https://jquery.com/'>JQuery(https://jquery.com/)</a> to handle DOM.<br>" +
                              "<a href='http://jqueryui.com/'>JQueryUI(http://jqueryui.com/)</a> to display calender.<br>" +
                              "<a href='https://developers.google.com/speed/libraries/'>Google Hosted Libraries</a> to load JQuery and JQueryUI.<br>" +
                              "<br><br>" +
                              "written by KUMA, some rights reserved.<br>" +
                              "licensed under CC0."
                             );

        $settingPain.append($Acknowledgement);
    }

    $div.append($settingPain);
    return $div;
}


//------------------------------------------------------------------------------
function init() {
    // 地図
    var map = new google.maps.Map($("#map")[0], {
        center: {lat: 34.6431, lng:134.9972},
        zoom: 8
    });

    // 設定ボタン
    var $ui = initUI($("<div>"), map);
    map.controls[google.maps.ControlPosition.TOP_LEFT].push($ui[0]);

    // クリックイベント
    google.maps.event.addListener(map, 'click', function(event){
        $sp = $("#settingPain");

        if ($sp.css("display") == "none") {
            updateMarker(map, event.latLng);
        } else {
            $sp.css("display", "none");
            if (marker) {
                updateMarker(map, marker.getPosition(), true);
            }
        }
    });

}
// Google Map 準備完了時に呼ばれる。
function readyMap() {$(init);}
