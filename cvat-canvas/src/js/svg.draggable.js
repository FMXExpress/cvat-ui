/*! svg.draggable.js - v2.2.2 - 2019-01-08
* https://github.com/svgdotjs/svg.draggable.js
* Copyright (c) 2019 Wout Fierens; Licensed MIT
*
* Vendored into cvat-canvas and converted from mouse/touch events to
* pointer events so that dragging works with pen input (Apple Pencil).
* Fingers intentionally do not drag: on touch devices they pan/pinch
* the canvas instead (see pointerRouter.ts).
*/
import * as SVG from 'svg.js';

(function() {

  // creates handler, saves it
  function DragHandler(el){
    el.remember('_draggable', this)
    this.el = el
    this.pointerId = null
  }


  // Sets new parameter, starts dragging
  DragHandler.prototype.init = function(constraint, val){
    var _this = this
    this.constraint = constraint
    this.value = val
    this.el.on('pointerdown.drag', function(e){ _this.start(e) })
  }

  // an event belongs to the active gesture when its pointerId matches the
  // one the gesture started with; synthetic events (dispatched by cvat-canvas
  // to force-stop a drag) and plain MouseEvents always pass
  DragHandler.prototype.ownsEvent = function(e){
    return typeof e.pointerId !== 'number' ||
      this.pointerId === null ||
      e.pointerId === this.pointerId ||
      !e.isTrusted
  }

  // transforms one point from screen to user coords
  DragHandler.prototype.transformPoint = function(event, offset){
      event = event || window.event
      var touches = event.changedTouches && event.changedTouches[0] || event
      this.p.x = touches.clientX - (offset || 0)
      this.p.y = touches.clientY
      return this.p.matrixTransform(this.m)
  }

  // gets elements bounding box with special handling of groups, nested and use
  DragHandler.prototype.getBBox = function(){

    var box = this.el.bbox()

    if(this.el instanceof SVG.Nested) box = this.el.rbox()

    if (this.el instanceof SVG.G || this.el instanceof SVG.Use || this.el instanceof SVG.Nested) {
      box.x = this.el.x()
      box.y = this.el.y()
    }

    return box
  }

  // start dragging
  DragHandler.prototype.start = function(e){

    // fingers pan and pinch the canvas, they never drag elements
    if(e.pointerType === 'touch') return

    // check for left button
    if(e.type == 'click'|| e.type == 'mousedown' || e.type == 'mousemove' || e.type == 'pointerdown'){
      if((e.which || e.buttons) != 1){
          return
      }
    }

    var _this = this

    // fire beforedrag event
    this.el.fire('beforedrag', { event: e, handler: this })
    if(this.el.event().defaultPrevented) return;

    // prevent browser drag behavior as soon as possible
    e.preventDefault();

    // prevent propagation to a parent that might also have dragging enabled
    e.stopPropagation();

    this.pointerId = typeof e.pointerId === 'number' ? e.pointerId : null

    // search for parent on the fly to make sure we can call
    // draggable() even when element is not in the dom currently
    this.parent = this.parent || this.el.parent(SVG.Nested) || this.el.parent(SVG.Doc)
    this.p = this.parent.node.createSVGPoint()

    // save current transformation matrix
    this.m = this.el.node.getScreenCTM().inverse()

    var box = this.getBBox()

    var anchorOffset;

    // fix text-anchor in text-element (#37)
    if(this.el instanceof SVG.Text){
      anchorOffset = this.el.node.getComputedTextLength();

      switch(this.el.attr('text-anchor')){
        case 'middle':
          anchorOffset /= 2;
          break
        case 'start':
          anchorOffset = 0;
          break;
      }
    }

    this.startPoints = {
      // We take absolute coordinates since we are just using a delta here
      point: this.transformPoint(e, anchorOffset),
      box:   box,
      transform: this.el.transform()
    }

    // add drag and end events to window
    SVG.on(window, 'pointermove.drag', function(e){ if(_this.ownsEvent(e) && e.pointerType !== 'touch') _this.drag(e) })
    SVG.on(window, 'pointerup.drag', function(e){ if(_this.ownsEvent(e)) _this.end(e) })
    SVG.on(window, 'pointercancel.drag', function(e){ if(_this.ownsEvent(e)) _this.end(e) })

    // fire dragstart event
    this.el.fire('dragstart', {event: e, p: this.startPoints.point, m: this.m, handler: this})
  }

  // while dragging
  DragHandler.prototype.drag = function(e){

    var box = this.getBBox()
      , p   = this.transformPoint(e)
      , x   = this.startPoints.box.x + p.x - this.startPoints.point.x
      , y   = this.startPoints.box.y + p.y - this.startPoints.point.y
      , c   = this.constraint
      , gx  = p.x - this.startPoints.point.x
      , gy  = p.y - this.startPoints.point.y

    this.el.fire('dragmove', {
        event: e
      , p: p
      , m: this.m
      , handler: this
    })

    if(this.el.event().defaultPrevented) return p

    // move the element to its new position, if possible by constraint
    if (typeof c == 'function') {

      var coord = c.call(this.el, x, y, this.m)

      // bool, just show us if movement is allowed or not
      if (typeof coord == 'boolean') {
        coord = {
          x: coord,
          y: coord
        }
      }

      // if true, we just move. If !false its a number and we move it there
      if (coord.x === true) {
        this.el.x(x)
      } else if (coord.x !== false) {
        this.el.x(coord.x)
      }

      if (coord.y === true) {
        this.el.y(y)
      } else if (coord.y !== false) {
        this.el.y(coord.y)
      }

    } else if (typeof c == 'object') {

      // keep element within constrained box
      if (c.minX != null && x < c.minX) {
        x = c.minX
        gx = x - this.startPoints.box.x
      } else if (c.maxX != null && x > c.maxX - box.width) {
        x = c.maxX - box.width
        gx = x - this.startPoints.box.x
      } if (c.minY != null && y < c.minY) {
        y = c.minY
        gy = y - this.startPoints.box.y
      } else if (c.maxY != null && y > c.maxY - box.height) {
        y = c.maxY - box.height
        gy = y - this.startPoints.box.y
      }

      if (c.snapToGrid != null) {
        x = x - (x % c.snapToGrid)
        y = y - (y % c.snapToGrid)
        gx = gx - (gx % c.snapToGrid)
        gy = gy - (gy % c.snapToGrid)
      }

      if(this.el instanceof SVG.G)
        this.el.matrix(this.startPoints.transform).transform({x:gx, y: gy}, true)
      else
        this.el.move(x, y)
    }

    // so we can use it in the end-method, too
    return p
  }

  DragHandler.prototype.end = function(e){

    // final drag
    var p = this.drag(e);

    // fire dragend event
    this.el.fire('dragend', { event: e, p: p, m: this.m, handler: this })

    // unbind events
    SVG.off(window, 'pointermove.drag')
    SVG.off(window, 'pointerup.drag')
    SVG.off(window, 'pointercancel.drag')

    this.pointerId = null

  }

  SVG.extend(SVG.Element, {
    // Make element draggable
    // Constraint might be an object (as described in readme.md) or a function in the form "function (x, y)" that gets called before every move.
    // The function can return a boolean or an object of the form {x, y}, to which the element will be moved. "False" skips moving, true moves to raw x, y.
    draggable: function(value, constraint) {

      // Check the parameters and reassign if needed
      if (typeof value == 'function' || typeof value == 'object') {
        constraint = value
        value = true
      }

      var dragHandler = this.remember('_draggable') || new DragHandler(this)

      // When no parameter is given, value is true
      value = typeof value === 'undefined' ? true : value

      if(value) dragHandler.init(constraint || {}, value)
      else {
        this.off('pointerdown.drag')
      }

      return this
    }

  })

}).call(this);
