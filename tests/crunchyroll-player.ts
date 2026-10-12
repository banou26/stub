import { expect } from 'chai'

import {
  clampCrunchyrollTime,
  normalizeCrunchyrollLabel,
  normalizeCrunchyrollTrackSelection,
} from '../src/sources/crunchyroll/cr-native-controls'

const option = (id: string, label: string, index: number, selected = false) => ({
  id,
  label,
  index,
  selected,
  disabled: false,
})

export const labels = () => {
  expect(normalizeCrunchyrollLabel('  Español   (América Latina)  ')).to.equal('Español (América Latina)')
}

export const selections = () => {
  expect(normalizeCrunchyrollTrackSelection('audio', [
    option('Japanese', 'Japanese', 0, true),
    option('English#1', 'English', 1),
    option('English#2', 'English', 2),
  ])).to.deep.equal({
    options: [
      { id: 'Japanese', label: 'Japanese', disabled: undefined },
      { id: 'English#1', label: 'English', disabled: undefined },
      { id: 'English#2', label: 'English', disabled: undefined },
    ],
    selectedId: 'Japanese',
  })
}

export const subtitleOff = () => {
  expect(normalizeCrunchyrollTrackSelection('subtitles', [
    option('Off', 'Off', 0, true),
    option('English', 'English', 1),
  ])).to.deep.equal({
    options: [{ id: 'English', label: 'English', disabled: undefined }],
    selectedId: null,
    offLabel: 'Off',
  })
  expect(normalizeCrunchyrollTrackSelection('subtitles', [
    option('None', 'None', 0, true),
    option('English', 'English', 1),
  ])).to.deep.equal({
    options: [{ id: 'English', label: 'English', disabled: undefined }],
    selectedId: null,
    offLabel: 'None',
  })
}

export const omittedSelections = () => {
  expect(normalizeCrunchyrollTrackSelection('audio', [
    option('Japanese', 'Japanese', 0, true),
  ])).to.equal(undefined)
  expect(normalizeCrunchyrollTrackSelection('subtitles', [
    option('English', 'English', 0, true),
  ])).to.equal(undefined)
}

export const playbackTime = () => {
  expect(clampCrunchyrollTime(-5, 100)).to.equal(0)
  expect(clampCrunchyrollTime(50, 100)).to.equal(50)
  expect(clampCrunchyrollTime(120, 100)).to.equal(99.9)
  expect(clampCrunchyrollTime(50, Number.NaN)).to.equal(50)
  expect(clampCrunchyrollTime(Number.NaN, 100)).to.equal(0)
}

// Crunchyroll checks a quality only when the viewer's profile answered before the stream loaded, and its three choices are there all the same
export const qualityBeforeTheProfile = () => {
  expect(normalizeCrunchyrollTrackSelection('quality', [
    option('Highest Available', 'Highest Available', 0),
    option('Moderate', 'Moderate', 1),
    option('Data Saver', 'Data Saver', 2),
  ])).to.deep.equal({
    options: [
      { id: 'Highest Available', label: 'Highest Available', disabled: undefined },
      { id: 'Moderate', label: 'Moderate', disabled: undefined },
      { id: 'Data Saver', label: 'Data Saver', disabled: undefined },
    ],
    selectedId: null,
  })
}
