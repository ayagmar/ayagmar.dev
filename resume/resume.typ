// One-page resume from content/about.json, the same data as the about page.
// Build: just resume (writes resume/build/resume.pdf).
#let about = json("/content/about.json")
#let id = about.identity

#let months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
// "2025-05" as "May 2025", like formatMonth in apps/site/src/data/about.ts.
#let month(value) = {
  let (year, number) = value.split("-")
  months.at(int(number) - 1) + " " + year
}
#let span(start, end) = month(start) + " to " + if end == none { "present" } else { month(end) }
#let bare(url) = url.trim("https://", at: start).trim("/", at: end)

#set document(title: id.name + ", resume", author: id.name, date: none)
#set page(paper: "a4", margin: (x: 1.6cm, y: 1.4cm))
#set text(font: "Libertinus Serif", size: 10pt, lang: "en")
#set par(justify: false, leading: 0.55em)
#show link: set text(fill: rgb("#1a4f8b"))
#show heading.where(level: 2): it => {
  v(0.6em)
  text(size: 11pt, weight: "bold", upper(it.body))
  v(-0.5em)
  line(length: 100%, stroke: 0.4pt)
  v(0.1em)
}

#text(size: 18pt, weight: "bold", id.name)
#linebreak()
#id.role, #id.location
#h(1fr)
#link(id.links.site, bare(id.links.site)) ·
#link(id.links.linkedin, bare(id.links.linkedin)) ·
#link(id.links.github, bare(id.links.github))

#about.summary

== Experience

#for role in about.experience [
  *#role.role*, #role.company #h(1fr) #span(role.start, role.end) \
  #text(style: "italic", role.place)
  #for outcome in role.outcomes [
    - #outcome
  ]
  #v(0.3em)
]

== Certifications

#for cert in about.certifications [
  *#cert.name*, #cert.issuer
  #if "credentialId" in cert [ (ID #cert.credentialId)]
  · #link(cert.verifyUrl)[verify]
  #h(1fr)
  #month(cert.issued)#if "expires" in cert [ to #month(cert.expires)] \
]

== Education

#for school in about.education [
  *#school.school* #h(1fr) #span(school.start, school.end) \
  #school.degree#if "field" in school [, #school.field]
]

== Skills

#about.skills.join(", ")

// The resume is one page. Longer content fails the build instead of spilling onto a second.
#context {
  let pages = counter(page).final().first()
  if pages > 1 {
    panic("the resume exceeds one page (" + str(pages) + " pages): shorten content/about.json")
  }
}
