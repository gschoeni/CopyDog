# CopyDog 🐕: The Collaborative Copy Editor and Wireframe tool

A collaborative web app that decouples website copy from wireframe design. Designers and copywriters can work together with their clients to work on versions of their website copy together. Designers could vibe code the wireframe, and have copywriters fill in the words OR a copywriter can start writing messy copy in a document righ away. Users can seamlessly toggle between wireframe and copywriting mode.

## Table of Contents

Use the table of contents to learn more about why the product exists, inspiration from other tools, or any other information you need as building out the application.

* [Why the project exists](docs/00_why.md) - Description of why we are building this tool
* [Product Inspiration](docs/01_inspiration.md) - Reference products we love
* [User Getting Started](docs/02_gettings_started.md) - How a user will use and easily get started with the tool
* [Features](docs/03_features.md) - Documentation for the features of the app
* [Plan](docs/04_planning.md) - Planning, current phase status, what's next.
* [Decisions](docs/05_decisions.md) - Working decisions & rationale.
* [Backlog](docs/06_backlog.md) - Ideas, links, future exploration.

## The primary UI

The UI can toggle between a document editor, a wireframe, or a dual panel view of both at the same time. It has an LLM agent that helps users vibe code their wireframes or brainstorm copy.

- **Copy Editor** — Google doc / Notion-style markdown editor, with sections that can be tied to the wireframe
  - **Copy Versioning** - Each user is able to propose edits in parallel, so you can quickly swap between versions while not stepping on each other's toes
  - **Active Copy** - Each user has their view of the wireframe, with certain versions "activated" so they can see how it all flows. They can quickly swap out which version of the copy is active.
- **Wireframe** — Live HTML wireframe preview with active copy substituted in
- **LLM Agent** - The user may update the wireframe or copy through a chat interface with an LLM agent

The Notion-style markdown editor has sections that contain copy and a type such as H1, H2, paragraph, bulleted list, etc. Each section is automatically (or manually) tied to part of the HTML, and is injected into a template. When the copy is updated in the markdown editor, it automatically updates the HTML wireframe.

The LLM agent can be prompted to update the layout of the wireframe. The prompt can either be text, an image, a sitemap, or a url that we crawl. This gives the user flexibility in how the import wireframes, then start iterating on the layout and copy at the same time.

## Agents & Code Contributions

Refer to [AGENT.md](AGENT.md) for how to contribute or write code for this project.

## Initial Prompt

This is the initial prompt we used to build the app, for reference, historical purposes, and for old times sake.

```
Build a collaborative web app that decouples website copy from wireframe design. Designers and copywriters can work together with their clients to work on different versions of their website copy together. Designers vibe code the wireframe, copywriters fill in the words. Users can seamlessly toggle between wireframe and copy editing mode. It is inspired by Google Docs/Notion for the copy editor, and Relume for the greyscale wireframe.

Refer to the README.md and read all the documents in the Table of Contents to understand what we are building before writing any code. After you have read all of the documentation, quiz me asking any clarifying questions before creating a plan. Once we come to a shared understanding of what we are building, and the architecture, you may start writing the detailed plan to the [docs/04_planning.md](docs/04_planning.md) markdown file we can refer to later. Only after we have our agreed upon plan, can we start writing code. If there are any documented design decisions you do not agree with, feel free to push back, or ask more questions, until we do agree. When we are done, the documentation should reflect everything we have discussed.

You are a seasoned designer who has worked at Apple, Notion, and Figma in the past. You are great at building clean, minimal, beautiful, aesthetically pleasing, and intuitive application. The user should be able to enter the application and understand exactly how to get started without any instruction.

Explore the documentation, ask me questions, and lets get going.
```