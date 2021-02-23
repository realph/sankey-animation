

// Load data from json asynchronously and when it's loaded run the chart
d3.json('data.json').then(run)


function run(rawData) {

  //
  // Constants
  //

  const width = Math.max(400, window.innerWidth)
  // height is dynamic and depends on data, so let's make it a function so it will be computed in runtime
  const height = () => margin.top + margin.bottom + hierarchy.leaves().length * (bandHeight * padding)
  const margin = { top: 100, right: 130, bottom: 10, left: 10 }
  const padding = 1.2 // padding between liks (1 = no padding)
  const psize = 7 // particle size
  const bandHeight = 100
  const speed = 1.7
  const density = 7
  // const totalParticles = 500 // will be set below when the data is parsed


  //
  // State
  //
  const particles = []
  const cache = {}


  //
  // Data
  //

  const isLeaf = n => n.hasOwnProperty('failed')


  // Convert the raw data from nested object format into `d3-hierarchy` compatible format,
  // so we can use `d3-cluster` to visualize the routes
  const hierarchy = (() => {
    // converts an object { bitA, bitB, ... } into array [{ name: 'bitA', ... }, { name: 'bitB', ... }, ...]
    // `d3.hierarchy` will use this array to build its data structure
    const getChildren = ({ name, ...otherProps }) => isLeaf(otherProps) ? undefined // leaves have no children
      : Object.entries(otherProps).map(([name, obj]) => ({ name, ...obj }))

    return d3.hierarchy({ name: 'root', ...rawData }, getChildren)
      // convert each nodes's data into universal format: `{ name, groups: [{ key, value }, ...] }`
      // so it does not depend on exact group names ('failed', 'success')
      // later it will allow to reuse the chart with other groups
      .each(d => {
        // NOTE: node names should be unique
        const datum = { name: d.data.name }
        if (isLeaf(d.data)) {
          datum.groups = [{
            key: 'failed', value: d.data.failed
          }, {
            key: 'success', value: d.data.success
          }]
        }
        d.data = datum
      })
  })()


  // Calculate x and y position of each node in the hierarchy
  // Note, that `d3.cluster` builds a vertical hierarhy, but we render it horizontally,
  // so we will switch `x` and `y` everywhere in the code
  const root = d3.cluster()
    .separation(() => 1) // comment this line to layout the target nodes in groups
    .size([height() - margin.top - margin.bottom, width - margin.left - margin.right])(hierarchy)


  // All routes from the root to a leaf
  const routes = root.leaves().map(l => root.path(l))


  // Consider different groups of the same route as different targets
  // Such data structure format simplifies particle creation and tracking
  const targetsAbsolute = root.leaves().flatMap(t => t.data.groups.map(g => ({
    name: t.data.name,
    group: g.key,
    value: g.value,
  })))


  const targets = (() => {
    // normalize values
    const total = d3.sum(targetsAbsolute, d => d.value)
    return targetsAbsolute.map(t => ({ ...t, value: t.value / total }))
  })()


  // Distribution of all possible types of particles (each route and each color)
  const thresholds = d3.range(targets.length).map(i => d3.sum(targets.slice(0, i + 1).map(r => r.value)))


  // set to absolute amount of students, but could be any value
  const totalParticles = d3.sum(targetsAbsolute, t => t.value)


  //
  // Scales
  //

  // takes a random number [0..1] and returns a target, based on distribution
  const targetScale = d3.scaleThreshold()
    .domain(thresholds)
    .range(targets)


  // takes a group type (e.g. 'failed' or 'success') and returns a color
  const colorScale = d3.scaleOrdinal()
    .domain(['success', 'failed'])
    .range(['plum', 'mediumslateblue'])


  // takes a random number [0..1] and returns vertical position on the band
  const offsetScale = d3.scaleLinear()
    .range([-bandHeight / 2, bandHeight / 2 - psize])


  // takes a random number [0..1] and returns particle speed
  const speedScale = d3.scaleLinear().range([speed, speed + 0.5])


  //
  // Code
  //

  // Randomly add from 0 to `density` particles per tick `t`
  const addParticlesMaybe = (t) => {
    const particlesToAdd = Math.round(Math.random() * density)
    for (let i = 0; i < particlesToAdd && particles.length < totalParticles; i++) {
      const target = targetScale(Math.random()) // target is an object: { name, group }
      const length = cache[target.name].points.length
      const particle = {
        // `id` is needed to distinguish the particles when some of them finish and disappear
        id: `${t}_${i}`,
        speed: speedScale(Math.random()),
        color: colorScale(target.group),
        // used to position a particle vertically on the band
        offset: offsetScale(Math.random()),
        // current position on the route (will be updated in `chart.update`)
        pos: 0,
        // when the particle is appeared
        createdAt: t,
        // total length of the route, used to determine that the particle has arrived
        length,
        // target where the particle is moving
        target,
      }
      particles.push(particle)
    }
  }


  // Gets a list of the nodes from the root to a leaf and returns a path thru these nodes
  const sankeyLinkCustom = nodes => {
    const curve = 0.27
    const w = width / hierarchy.height
    const p = d3.path()
    for (let i = 1; i < nodes.length; i++) {
      // The cluster layout is vertical, but we render links horizontally, so swap y's and x's
      const { x: sy, y: sx } = nodes[i - 1] // source node
      const { x: ty, y: tx } = nodes[i] // target node
      p.moveTo(sx, sy)
      p.lineTo(sx + w * curve, sy)
      p.bezierCurveTo(
        sx + w / 2, sy,
        sx + w / 2, ty,
        sx + w * (1-curve), ty
      )
      p.lineTo(tx, ty)
    }
    return p.toString()
  }


  //
  // Chart
  //

  function chart() {
    const svg = d3.select('#app').append('svg')
      .attr('width', width)
      .attr('height', height())

    const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`)


    // Apart from aesthetics, routes serve as a trajectory for the moving particles.
    // We'll compute particle positions in the next step
    //
    const route = g.append("g").attr('class', 'routes')
      .attr("fill", "none")
      .attr("stroke-opacity", .51)
      .attr("stroke", "#eee")
      .selectAll("path").data(routes)
      .join("path")
        // use custom sankey function here because we don't care of the node heights and link widths
        .attr('d', sankeyLinkCustom)
        .attr("stroke-width", bandHeight)

    // Compute particle positions along the routes.
    // This technic relies on path.getPointAtLength function that returns coordinates of a point on the path
    // Another example of this technic:
    // https://observablehq.com/@oluckyman/point-on-a-path-detection
    //
    route.each(function(nodes) {
      const path = this
      const length = path.getTotalLength()
      const points = d3.range(length).map(l => {
        const point = path.getPointAtLength(l)
        return { x: point.x, y: point.y }
      })
      // store points for each route in the cache to use during the animation
      const lastNode = nodes[nodes.length - 1]
      const key = `${lastNode.data.name}`
      cache[key] = { points }
    })

    // Create a container for particles first,
    // to keep particles below the labels which are declared next
    const particlesContainer = g.append('g')

    // Labels
    //
    g.selectAll('.label').data(root.descendants().slice(1)) // `.slice(1)` to skip the root node
      .join('g').attr('class', 'label')
      .attr('transform', d => `translate(${d.y - bandHeight / 2}, ${d.x})`)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', 'end')
      // This is how we make labels visible on multicolor background
      // we create two <text> with the same label
      .call(label => label.append('text')
        // the lower <text> serves as outline to make contrast
        .attr('stroke', 'white')
        .attr('stroke-width', 3)
        .text(d => d.data.name))
        // the upper <text> is the actual label
      .call(label => label.append('text')
        .attr('fill', '#444')
        .text(d => d.data.name))


    // Counters
    //
    const counters = g.selectAll('.counter').data(root.leaves())
      .join('g').attr('class', 'counter')
      .attr('transform', d => `translate(${width - margin.left * 2}, ${d.x - bandHeight / 2})`)
      .each(function(target, i) {
        d3.select(this).selectAll('.group').data(d => d.data.groups)
          .join('g').attr('class', 'group')
          .attr('transform', (d, i) => `translate(${-i * 60}, 0)`)
          // Align coutners to the right, because running numbers are easier for the eye to compare this way
          .attr('text-anchor', 'end')
          // Use monospaced font to keep digits aligned as they change during the animation
          .style('font-family', 'Menlo')
          // Add group titles only once, on the top
          .call(g => i === 0 && g.append('text')
            .attr('dominant-baseline', 'hanging')
            .attr('fill', '#999')
            .style('font-size', 9)
            .style('text-transform', 'uppercase')
            .style('letter-spacing', .7) // a rule of thumb: increase letter spacing a bit, when use uppercase
            .text(d => d.key)
          )
          // Absolute counter values
          .call(g => g.append('text').attr('class', 'absolute')
            .attr('fill', d => colorScale(d.key))
            .attr('font-size', 20)
            .attr('dominant-baseline', 'middle')
            .attr('y', bandHeight / 2 - 2)
            .text(0) // will be updated during the animation
          )
          // Percentage counter values
          .call(g => g.append('text').attr('class', 'percent')
            .attr('dominant-baseline', 'hanging')
            .attr('fill', '#999')
            .attr('font-size', 9)
            .attr('y', bandHeight / 2 + 9)
            .text('0%')  // will be updated during the animation
          )
      })


      // update will be called on each tick, so here we'll perform our animation step
      function update(t) {
        // add particles if needed
        //
        addParticlesMaybe(t)

        // update counters
        //
        counters.each(function(d) {
          const finished = particles
            .filter(p => p.target.name === d.data.name)
            .filter(p => p.pos >= p.length)

          d3.select(this).selectAll('.group').each(function(group) {
            const count = finished.filter(p => p.target.group === group.key).length
            d3.select(this).select('.absolute').text(count)
            d3.select(this).select('.percent').text(d3.format('.0%')(count / totalParticles))
          })
        })

        // move particles
        //
        particlesContainer.selectAll('.particle').data(particles.filter(p => p.pos < p.length), d => d.id)
          .join(
            enter => enter.append('rect')
              .attr('class', 'particle')
              .attr('opacity', 0.8)
              .attr('fill', d => d.color)
              .attr('width', psize)
              .attr('height', psize),
            update => update,
            exit => exit.remove()
          )
          // At this point we have `cache` with all possible coordinates.
          // We just need to figure out which exactly coordinates to use at time `t`
          //
          .each(function(d) {
            // every particle appears at its own time, so adjust the global time `t` to local time
            const localTime = t - d.createdAt
            d.pos = localTime * d.speed
            // extract current and next coordinates of the point from the precomputed cache
            const index = Math.floor(d.pos)
            const coo = cache[d.target.name].points[index]
            const nextCoo = cache[d.target.name].points[index + 1]
            if (coo && nextCoo) {
              // `index` is integer, but `pos` is float, so there are ticks when the particle is
              // between the two precomputed points. We use `delta` to compute position between the current
              // and the next coordinates to make the animation smoother
              const delta = d.pos - index // try to set it to 0 to see how jerky the animation is
              const x = coo.x + (nextCoo.x - coo.x) * delta
              const y = coo.y + (nextCoo.y - coo.y) * delta
              d3.select(this)
                .attr('x', x)
                .attr('y', y + d.offset)
            }
        })
      } // update

      // expose the internal `update` function so it can be called from outside
      chart.update = update
   } // chart


  // Render the chart
  chart()

  // Run the animation ~60 times per second
  let elapsed = 0
  requestAnimationFrame(function update() {
    chart.update(elapsed++)
    requestAnimationFrame(update)
  })

} // run
