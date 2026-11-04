'use strict';

// Real appraisals number the subject-land table heading ("3. 토지조서", "사. 토지조서",
// "Ⅲ. 편입토지 목록"), so the anchored heading patterns used by the segmenter and the
// lands extractor have to tolerate an ordinal prefix. Keeping the pieces in one module
// stops the segmenter and the extractor from drifting apart.
const ORDINAL_PREFIX_SOURCE = '(?:\\(\\s*(?:\\d{1,2}|[가-힣]|[IVXivx]{1,4})\\s*\\)|(?:\\d{1,2}(?:[.-]\\d{1,2})?|[가-힣]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4}|[IVXivx]{1,4}))\\s*[.)]?\\s*';

const SUBJECT_HEADING_CORE_SOURCE = '(?:편\\s*입\\s*토\\s*지(?:\\s*목\\s*록)?|토\\s*지\\s*(?:평\\s*가\\s*)?조\\s*서|보\\s*상\\s*대\\s*상\\s*토\\s*지(?:\\s*목\\s*록)?|대\\s*상\\s*토\\s*지\\s*목\\s*록)';

// "토지조서(협의)" 처럼 표제 뒤에 괄호 설명이 붙는 서식.
const DESCRIPTOR_SUFFIX_SOURCE = '(?:\\s*[\\(（][^\\)）\\r\\n]{1,160}[\\)）])?';

// 쪽번호는 "- 12 -", "[12]", "p.12", "12쪽" 처럼 숫자가 앞에 오기도 하고,
// "페이지:118", "page: 3" 처럼 라벨이 앞에 붙기도 한다. 둘 다 표제의 일부가 아니다.
const PAGE_SUFFIX_SOURCE = '(?:\\s*(?:[-–—]\\s*)?[\\[(]?\\s*(?:(?:페\\s*이\\s*지|쪽|p(?:age)?)\\s*[.:：]?\\s*)?\\d{1,3}(?:\\s*[/.-]\\s*\\d{1,3})?\\s*(?:쪽|페이지)?\\s*[\\])]??\\s*(?:[-–—])?)?';

const SUBJECT_HEADING_PATTERN = new RegExp(
  `^(?:${ORDINAL_PREFIX_SOURCE})?${SUBJECT_HEADING_CORE_SOURCE}${DESCRIPTOR_SUFFIX_SOURCE}${PAGE_SUFFIX_SOURCE}\\s*$`,
  'i',
);

const SUBJECT_HEADING_CORE_PATTERN = new RegExp(
  `^(?:${ORDINAL_PREFIX_SOURCE})?${SUBJECT_HEADING_CORE_SOURCE}`,
  'i',
);

const SUBJECT_HEADING_LABEL_PATTERN = new RegExp(SUBJECT_HEADING_CORE_SOURCE, 'g');

module.exports = {
  ORDINAL_PREFIX_SOURCE,
  SUBJECT_HEADING_CORE_SOURCE,
  SUBJECT_HEADING_PATTERN,
  SUBJECT_HEADING_CORE_PATTERN,
  SUBJECT_HEADING_LABEL_PATTERN,
};
