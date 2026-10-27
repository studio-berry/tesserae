import { describe, expect, it } from 'vitest'
import { svgObject } from './svg'

const PATH = '<path d="M0 0L10 0L10 10Z"/>'

describe('svgObject', () => {
  it('draws a path', () => {
    expect(svgObject(`<svg>${PATH}</svg>`)).not.toBeNull()
  })

  it('does not draw what a script holds, however its closing tag is written', () => {
    // a script's text can hold what reads as a closing tag; parsed as tags, it would end the
    // script's hidden run early and draw the path after it
    const code = `if (a </g> b) {} ${PATH}`
    expect(svgObject(`<svg><script>${code}</script></svg>`)).toBeNull()
    expect(svgObject(`<svg><SCRIPT>${code}</script foo="bar"></svg>`)).toBeNull()
    expect(svgObject(`<svg><script>${code}</script\n></svg>`)).toBeNull()
  })

  it('does not draw what a comment or CDATA holds, closed or left open', () => {
    expect(svgObject(`<svg><!-- ${PATH} --></svg>`)).toBeNull()
    expect(svgObject(`<svg><![CDATA[ ${PATH} ]]></svg>`)).toBeNull()
    expect(svgObject(`<svg><!-- ${PATH}`)).toBeNull()
    // a removed run never joins its neighbours into a new comment opener
    expect(svgObject(`<svg><!-<!-- x -->- ${PATH} --></svg>`)).not.toBeNull()
  })

  it('still draws a tag whose name only starts like script', () => {
    expect(svgObject(`<svg><scripted/>${PATH}</svg>`)).not.toBeNull()
  })
})
