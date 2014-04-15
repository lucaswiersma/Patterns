/**
 * Patterns calendar - Calendar with different views for patterns.
 *
 * Copyright 2013-2014 Marko Durkovic
 * Copyright 2014 Florian Friesdorf
 * Copyright 2014 Syslab.com GmbH
 */
define([
    "jquery",
    "pat-logger",
    "pat-parser",
    "pat-store",
    "pat-utils",
    "pat-registry",
    "pat-calendar-moment-timezone-data",
    "jquery.fullcalendar.dnd",
    "jquery.fullcalendar"
], function($, logger, Parser, store, utils, registry) {
    "use strict";
    var log = logger.getLogger("calendar"),
        parser = new Parser("calendar");

    parser.add_argument("height", "auto");
    parser.add_argument("start-date");
    parser.add_argument("time-format", "h(:mm)t");
    parser.add_argument("title-month", "MMMM YYYY");
    parser.add_argument("title-week", "MMM D YYYY");
    parser.add_argument("title-day", "dddd, MMM d, YYYY");
    parser.add_argument("column-month", "ddd");
    parser.add_argument("column-week", "ddd M/d");
    parser.add_argument("column-day", "dddd M/d");
    parser.add_argument("first-day", "0");
    parser.add_argument("first-hour", "6");
    parser.add_argument("calendar-controls", "");
    parser.add_argument("category-controls", "");
    parser.add_argument("default-view", "month",
                        ["month", "basicWeek", "basicDay",
                         "agendaWeek", "agendaDay"]);
    parser.add_argument("store", "none", ["none", "session", "local"]);
    parser.add_argument("ignore-url", false);

    var calendar = {
        name: "calendar",
        trigger: ".pat-calendar",

        _parseSearchString: function() {
            var context = {};
            window.location.search.substr(1).split("&").forEach(function(str) {
                if (str) {
                    var keyValue = str.split("="),
                        key = keyValue[0],
                        value = decodeURIComponent(keyValue[1]);
                    if (value && (value.match(/^\[.*\]$/) ||
                                  value.match(/^\{.*\}$/))) {
                        context[key] = JSON.parse(value);
                    } else {
                        context[key] = value;
                    }
                }
            });
            return context;
        },

        init: function($el, opts) {
            opts = opts || {};
            var cfg = store.updateOptions($el[0], parser.parse($el)),
                storage = cfg.store === "none" ? null : store[cfg.store](calendar.name + $el[0].id);
            calendar.cfg = cfg;
            calendar.storage = storage;
            cfg.defaultDate = storage.get("date") || cfg.defaultDate;
            cfg.defaultView = storage.get("view") || cfg.defaultView;
            cfg.tooltip = $el.data('patCalendarTooltip');

            if (!opts.ignoreUrl) {
                var search = calendar._parseSearchString();
                if (search["default-date"]) {
                    cfg.defaultDate = search["default-date"];
                }
                if (search["default-view"]) {
                    cfg.defaultView = search["default-view"];
                }
            }

            var calOpts = {
                axisFormat: cfg.timeFormat,
                columnFormat: cfg.column,
                defaultDate: cfg.defaultDate,
                defaultView: cfg.defaultView,
                droppable: true,
                editable: true,
                firstHour: cfg.first.hour,
                header: false,
                timeFormat: cfg.timeFormat,
                titleFormat: cfg.title,
                viewRender: calendar.highlightButtons,
                height: cfg.height !== "auto" ? cfg.height : undefined,

                // Callback functions
                // ------------------
                eventDrop: function(event) {
                    $.getJSON(
                        event.url,
                        { 'start': event.start.toISOString(),
                            'end': event.end.toISOString(),
                            'pat-calendar-event-drop': true
                        }
                    );
                },
                events: function(start, end, timezone, callback) {
                    var events = calendar.parseEvents($el, timezone);
                    callback(events);
                },
                dayClick: function () {
                    /* Allows for a tooltip (via pat-tooltip) to be shown
                        * when a user clicks on a day.
                        *
                        * The configuration is the same as pat-tooltip but
                        * appears under "data-pat-calendar-tooltip".
                        */
                    if (!cfg.tooltip) {
                        return;
                    }
                    var $el = $(this);
                    if (!$el.hasClass('pat-tooltip')) {
                        /* Retrieve the injection URL from the tooltip
                            * config data and add the day's date to its query
                            * string.
                            * Then take this data and use it to create and
                            * configure a tooltip trigger element, which is
                            * then triggered.
                            */
                        var match = cfg.tooltip.match(/url:[ ](.*?)(;|$)/),
                            data = cfg.tooltip.replace(match[0], ''),
                            url = utils.addURLQueryParameter(match[1], 'date', $(this).data('date'));
                        registry.scan($el.addClass('pat-tooltip').attr({'data-pat-tooltip': data}).attr({'href': url}));
                        $el.trigger('click.tooltip');
                    }
                }
            };

            var dayNames = [ "su", "mo", "tu", "we", "th", "fr", "sa" ];
            if (dayNames.indexOf(cfg.first.day) >= 0) {
                calOpts.firstDay = dayNames.indexOf(cfg.first.day);
            }

            $el.categories = $el.find(".cal-events .cal-event")
                .map(function() {
                    return this.className.split(" ").filter(function(cls) {
                        return (/^cal-cat/).test(cls);
                    });
                });

            calendar._registerEventRefetchers($el);
            calendar._registerCategoryControls($el);

            var $controlRoot = cfg.calendarControls ?
                    $(cfg.calendarControls) : $el;
            $el.$controlRoot = $controlRoot;
            calOpts.timezone = $controlRoot.find("select.timezone").val();

            $el.fullCalendar(calOpts);
            // move to end of $el
            $el.find(".fc-content").appendTo($el);

            if (cfg.height === "auto") {
                $el.fullCalendar("option", "height",
                    $el.find(".fc-content").height());

                $(window).on("resize.pat-calendar", function() {
                    $el.fullCalendar("option", "height",
                        $el.find(".fc-content").height());
                });
                $(document).on("pat-update.pat-calendar", function() {
                    $el.fullCalendar("option", "height",
                        $el.find(".fc-content").height());
                });
            }

            // update title
            var $title = $el.find(".cal-title");
            $title.text($el.fullCalendar("getView").title);

            var classMap = {
                month: ".view-month",
                agendaWeek: ".view-week",
                agendaDay: ".view-day"
            };
            $el.$controlRoot.find(classMap[calOpts.defaultView]).addClass("active");

            calendar._registerCalendarControls($el);
            $el.find(".cal-events").css("display", "none");
        },

        _refetchEvents: function($el) { 
            $el.fullCalendar("refetchEvents");
        },

        _registerEventRefetchers: function($el) {
            /* Register handlers for those IO events that necessitate a refetching
             * of the calendar's event objects.
             */
            $el.on("keyup.pat-calendar", ".filter .search-text",
                   utils.debounce(calendar._refetchEvents.bind(calendar, $el), 400));
            $el.on("click.pat-calendar", ".filter .search-text[type=search]",
                   utils.debounce(calendar._refetchEvents.bind(calendar, $el), 400));
            $el.on("change.pat-calendar", ".filter select[name=state]",
                   calendar._refetchEvents.bind(calendar, $el));
            $el.on("change.pat-calendar", ".filter .check-list",
                   calendar._refetchEvents.bind(calendar, $el));
        },

        _registerCategoryControls: function($el) {
            /* The "category controls" are checkboxes that cause different
             * types of events to be shown or hidden.
             *
             * Configured via the "category-controls" parser argument.
             *
             * Events will be refetched.
             */
            var $categoryRoot = calendar.cfg.categoryControls ?
                    $(calendar.cfg.categoryControls) : $el;
            $el.$catControls = $categoryRoot.find("input[type=checkbox]");
            $el.$catControls.on("change.pat-calendar", calendar._refetchEvents.bind(calendar, $el));
        },

        _registerCalendarControls: function($el) {
            /* Register handlers for the calendar control elements.
             *
             * Configured via the "calendar-controls" parser argument.
             */
            $el.$controlRoot.on("click.pat-calendar", ".jump-next", function() {
                $el.fullCalendar("next");
                calendar._viewChanged($el);
            });
            $el.$controlRoot.on("click.pat-calendar", ".jump-prev", function() {
                $el.fullCalendar("prev");
                calendar._viewChanged($el);
            });
            $el.$controlRoot.on("click.pat-calendar", ".jump-today", function() {
                $el.fullCalendar("today");
                calendar._viewChanged($el);
            });
            $el.$controlRoot.on("click.pat-calendar", ".view-month", function() {
                $el.fullCalendar("changeView", "month");
                calendar._viewChanged($el);
            });
            $el.$controlRoot.on("click.pat-calendar", ".view-week", function() {
                $el.fullCalendar("changeView", "agendaWeek");
                calendar._viewChanged($el);
            });
            $el.$controlRoot.on("click.pat-calendar", ".view-day", function() {
                $el.fullCalendar("changeView", "agendaDay");
                calendar._viewChanged($el);
            });
            $el.$controlRoot.on("change.pat-calendar", "select.timezone", function(ev) {
                calendar.destroy($el);
                calendar.init($el, {ignoreUrl: true});
            });
        },

        destroy: function($el) {
            $el.off(".pat-calendar");
            $el.$catControls.off(".pat-calendar");
            $el.$controlRoot.off(".pat-calendar");
            $(window).off(".pat-calendar");
            $(document).off(".pat-calendar");
            $(".cal-events .cal-event").off(".pat-calendar");
            $el.fullCalendar("destroy");
        },

        _viewChanged: function($el) {
            // update title
            var $title = $el.find(".cal-title");
            $title.html($el.fullCalendar("getView").title);
            // adjust height
            if (calendar.cfg.height === "auto") {
                $el.fullCalendar("option", "height",
                                 $el.find(".fc-content").height());
            }
            // store current date and view
            var date = $el.fullCalendar("getDate").format(),
                view = $el.fullCalendar("getView").name;
            calendar.storage.set("date", date);
            calendar.storage.set("view", view);
        },

        highlightButtons: function(view, element) {
            var $el = element.parents(".pat-calendar").first(),
                $body = element.parents("body").first(),
                $today = $el.find(".jump-today");
            $today.removeClass("active");
            if (view.name === "agendaDay") {
                var calDate = $el.fullCalendar("getDate"),
                    today = $.fullCalendar.moment();
                if (calDate.date() === today.date() &&
                    calDate.month() === today.month() &&
                    calDate.year() === today.year()) {
                    $today.addClass("active");
                }
            }

            var classMap = {
                month: ".view-month",
                agendaWeek: ".view-week",
                agendaDay: ".view-day"
            };
            $body.find(".view-month").removeClass("active");
            $body.find(".view-week").removeClass("active");
            $body.find(".view-day").removeClass("active");
            $body.find(classMap[view.name]).addClass("active");
        },

        parseEvents: function($el, timezone) {
            var $events = $el.find(".cal-events"),
                $filter = $el.find(".filter"),
                searchText,
                regex;

            // parse filters
            if ($filter && $filter.length > 0) {
                searchText = $(".search-text", $filter).val();
                regex = new RegExp(searchText, "i");
            }

            var shownCats = $el.categories.filter(function() {
                var cat = this;
                return $el.$catControls.filter(function() {
                    return this.checked &&
                        $(this)
                            .parents()
                            .andSelf()
                            .hasClass(cat);
                }).length;
            });

            var events = $events.find(".cal-event").filter(function() {
                var $event = $(this);

                if (searchText && !regex.test($event.find(".title").text())) {
                    log.debug("remove due to search-text="+searchText, $event);
                    return false;
                }

                return shownCats.filter(function() {
                    return $event.hasClass(this);
                }).length;
            }).map(function(idx, event) {
                var attr, i;

                // classNames: all event classes without "event" + anchor classes
                var classNames = $(event).attr("class").split(/\s+/)
                    .filter(function(cls) { return (cls !== "cal-event"); })
                    .concat($("a", event).attr("class").split(/\s+/));

                // attrs: all "data-" attrs from anchor
                var allattrs = $("a", event)[0].attributes,
                    attrs = {};
                for (attr, i=0; i<allattrs.length; i++){
                    attr = allattrs.item(i);
                    if (attr.nodeName.slice(0,5) === "data-") {
                        attrs[attr.nodeName] = attr.nodeValue;
                    }
                }

                var location = ($(".location", event).html() || "").trim();
                var startstr = $(".start", event).attr("datetime"),
                    endstr = $(".end", event).attr("datetime"),
                    start = $.fullCalendar.moment.parseZone(startstr),
                    end = $.fullCalendar.moment.parseZone(endstr);

                if (timezone) {
                    start = start.tz(timezone);
                    end = end.tz(timezone);
                }
                var ev = {
                    title: $(".title", event).text().trim() +
                        (location ? (" (" + location + ")") : ""),
                    start: start.format(),
                    end: end.format(),
                    allDay: $(event).hasClass("all-day"),
                    url: $("a", event).attr("href"),
                    className: classNames,
                    attrs: attrs,
                    editable: true // FIXME: $(event).hasClass("editable")
                };
                if (!ev.title) {
                    log.error("No event title for:", event);
                }
                if (!ev.start) {
                    log.error("No event start for:", event);
                }
                if (!ev.url) {
                    log.error("No event url for:", event);
                }
                return ev;
            }).toArray();
            return events;
        }
    };
    registry.register(calendar);
});
// jshint indent: 4, browser: true, jquery: true, quotmark: double
// vim: sw=4 expandtab
