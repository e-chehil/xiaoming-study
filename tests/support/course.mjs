import {readFile} from 'node:fs/promises';
import {hydrateCourse} from '../../public/lesson-data.mjs';
export async function loadCourse(course='simplified') {
  const path=course==='traditional'?'traditional/':'';
  return hydrateCourse(JSON.parse(await readFile(new URL('../../public/data/'+path+'learning-runtime.json',import.meta.url),'utf8')));
}
